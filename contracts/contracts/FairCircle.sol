// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {
    Nox,
    ebool,
    euint256,
    externalEuint256
} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {IERC7984} from "@iexec-nox/nox-confidential-contracts/contracts/interfaces/IERC7984.sol";
import {
    IERC7984Receiver
} from "@iexec-nox/nox-confidential-contracts/contracts/interfaces/IERC7984Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract FairCircle is IERC7984Receiver {
    uint8 public constant MIN_MEMBERS = 2;
    uint8 public constant MAX_MEMBERS = 8;
    uint8 public constant MIN_OPTIONS = 1;
    uint8 public constant MAX_OPTIONS = 4;
    uint256 public constant MAX_SUPPORTED_AMOUNT = 1e36;

    enum RoomMode {
        QuietBudget,
        FairSplit,
        PrivateCircle,
        PlanTogether
    }

    enum RoomStatus {
        CollectingInputs,
        ReadyForDecryption,
        Finalized,
        Cancelled
    }

    enum SplitMethod {
        Equal,
        CapacityWeighted
    }

    enum CollectionAccess {
        Open,
        InviteOnly
    }

    enum CollectionStatus {
        Open,
        Closed,
        WithdrawalPending,
        Withdrawn,
        Cancelled
    }

    struct RoomView {
        uint256 id;
        string title;
        address organizer;
        RoomMode mode;
        RoomStatus status;
        uint64 submissionDeadline;
        uint8 memberCount;
        uint8 submissionCount;
        uint8 optionCount;
        uint8 finalizedOptionCount;
    }

    struct PrivateCircleView {
        uint256 id;
        string title;
        address organizer;
        address confidentialToken;
        address recipient;
        uint256 publicTarget;
        uint64 deadline;
        CollectionAccess access;
        CollectionStatus collectionStatus;
        uint256 verifiedContributionCount;
        uint256 uniqueContributorCount;
        uint64 targetVersion;
    }

    struct ContributionView {
        uint256 id;
        uint256 roomId;
        address contributor;
        bool finalized;
        bool accepted;
    }

    struct Contribution {
        bool exists;
        uint256 roomId;
        address contributor;
        euint256 receipt;
        ebool positiveHandle;
        bool finalized;
        bool accepted;
    }

    struct Room {
        bool exists;
        string title;
        address organizer;
        RoomMode mode;
        RoomStatus status;
        uint64 submissionDeadline;
        uint8 memberCount;
        uint8 submissionCount;
        uint8 optionCount;
        uint8 finalizedOptionCount;
        address[] members;
        uint256[] optionCosts;
        euint256[] encryptedOptionCosts;
        ebool[] affordabilityHandles;
        bool[] affordabilityFinalized;
        bool[] publicAffordability;
        euint256 aggregateCapacity;
        SplitMethod splitMethod;
        uint256 splitTotalCost;
        euint256 encryptedSplitTotalCost;
        ebool splitFeasibilityHandle;
        bool splitFeasibilityFinalized;
        bool publicSplitFeasible;
        bool splitSharesReady;
        address roundingRecipient;
        CollectionAccess collectionAccess;
        CollectionStatus collectionStatus;
        address confidentialToken;
        address recipient;
        uint256 publicTarget;
        euint256 encryptedTarget;
        euint256 collectionAggregate;
        ebool collectionTargetHandle;
        uint64 collectionTargetVersion;
        uint64 finalizedTargetVersion;
        bool collectionTargetFinalized;
        bool publicTargetReached;
        bool collectionCallbackReceived;
        uint256 verifiedContributionCount;
        uint256 uniqueContributorCount;
        bool withdrawalRequested;
        bool withdrawalFinalized;
        euint256 withdrawalHandle;
        ebool withdrawalSuccessHandle;
        mapping(address account => bool) isMember;
        mapping(address account => bool) submitted;
        mapping(address account => euint256) capacities;
        mapping(address account => euint256) shares;
        mapping(address account => euint256) cumulativeContributions;
        mapping(address account => bool) hasVerifiedContribution;
    }

    uint256 public nextRoomId = 1;
    uint256 public nextContributionId = 1;

    mapping(uint256 roomId => Room) private rooms;
    mapping(uint256 contributionId => Contribution) private contributions;
    bool private locked;

    error InvalidRoomId(uint256 roomId);
    error InvalidMode(RoomMode mode);
    error InvalidMemberCount(uint256 count);
    error InvalidMember(address member);
    error DuplicateMember(address member);
    error InvalidOptionCount(uint256 count);
    error InvalidOptionCost(uint256 cost);
    error DuplicateOptionCost(uint256 cost);
    error InvalidDeadline(uint64 deadline);
    error NotMember(address account);
    error AlreadySubmitted(address account);
    error SubmissionClosed(uint256 roomId);
    error RoomNotCollecting(RoomStatus status);
    error RoomNotReady(RoomStatus status);
    error InvalidOptionIndex(uint256 optionIndex);
    error AffordabilityAlreadyFinalized(uint256 optionIndex);
    error NotOrganizer(address caller);
    error CancellationClosed(RoomStatus status);
    error CapacityNotSubmitted(address account);
    error WrongRoomMode(RoomMode expected, RoomMode actual);
    error InvalidSplitMethod(SplitMethod method);
    error InvalidTotalCost(uint256 totalCost);
    error AmountTooLarge(uint256 amount);
    error SplitCapacitySubmissionNotAllowed(SplitMethod method);
    error SplitFeasibilityNotReady();
    error SplitFeasibilityAlreadyFinalized();
    error SharesNotReady(uint256 roomId);
    error ZeroAggregateCapacity(uint256 roomId);
    error InvalidToken(address token);
    error InvalidRecipient(address recipient);
    error InvalidTarget(uint256 target);
    error InvalidCollectionMembers(uint256 count);
    error CollectionNotOpen(CollectionStatus status);
    error CollectionClosed(uint256 roomId);
    error UnauthorizedCallbackToken(address token);
    error InvalidCallbackData();
    error InvalidContributionId(uint256 contributionId);
    error ContributionAlreadyFinalized(uint256 contributionId);
    error NotContributor(address caller);
    error ContributionNotAvailable(address account);
    error TargetNotConfigured(uint256 roomId);
    error TargetNotReady(uint256 roomId);
    error TargetAlreadyFinalized(uint256 roomId, uint64 version);
    error CollectionHasContributions(uint256 roomId);
    error WithdrawalNotAllowed(uint256 roomId);
    error ZeroContributionCollection(uint256 roomId);
    error WithdrawalAlreadyRequested(uint256 roomId);
    error WithdrawalNotRequested(uint256 roomId);
    error WithdrawalAlreadyFinalized(uint256 roomId);
    error WithdrawalFailed(uint256 roomId);
    error ReentrantCall();

    event RoomCreated(
        uint256 indexed roomId,
        string title,
        address indexed organizer,
        RoomMode mode,
        uint64 submissionDeadline,
        uint8 memberCount,
        uint8 optionCount
    );
    event CapacitySubmitted(uint256 indexed roomId, address indexed member, uint8 submissionCount);
    event AffordabilityReady(uint256 indexed roomId, uint8 indexed optionIndex);
    event AffordabilityFinalized(uint256 indexed roomId, uint8 indexed optionIndex, bool affordable);
    event RoomFinalized(uint256 indexed roomId);
    event RoomCancelled(uint256 indexed roomId);
    event FairSplitRoomCreated(
        uint256 indexed roomId,
        string title,
        address indexed organizer,
        SplitMethod splitMethod,
        uint64 submissionDeadline,
        uint8 memberCount
    );
    event SplitCapacitySubmitted(
        uint256 indexed roomId,
        address indexed member,
        uint8 submissionCount
    );
    event SplitFeasibilityReady(uint256 indexed roomId);
    event SplitFeasibilityFinalized(uint256 indexed roomId, bool feasible);
    event SharesCalculated(uint256 indexed roomId);
    event PrivateCircleCreated(
        uint256 indexed roomId,
        string title,
        address indexed organizer,
        address indexed confidentialToken,
        address recipient,
        CollectionAccess access,
        uint64 deadline,
        bool hasTarget
    );
    event ContributionReceived(
        uint256 indexed roomId,
        uint256 indexed contributionId,
        address indexed contributor
    );
    event ContributionFinalized(
        uint256 indexed roomId,
        uint256 indexed contributionId,
        address indexed contributor,
        bool accepted,
        uint256 verifiedContributionCount,
        uint256 uniqueContributorCount
    );
    event CollectionTargetReady(uint256 indexed roomId, uint64 indexed version);
    event CollectionTargetFinalized(uint256 indexed roomId, uint64 indexed version, bool reached);
    event PrivateCircleClosed(uint256 indexed roomId);
    event CollectionWithdrawalRequested(uint256 indexed roomId, address indexed recipient);
    event CollectionWithdrawn(uint256 indexed roomId, address indexed recipient);
    event PrivateCircleCancelled(uint256 indexed roomId);

    modifier nonReentrant() {
        if (locked) {
            revert ReentrantCall();
        }
        locked = true;
        _;
        locked = false;
    }

    function createQuietBudgetRoom(
        string calldata title,
        address[] calldata members,
        uint256[] calldata optionCosts,
        uint64 submissionDeadline,
        RoomMode mode
    ) external returns (uint256 roomId) {
        if (mode != RoomMode.QuietBudget && mode != RoomMode.PlanTogether) {
            revert InvalidMode(mode);
        }
        if (members.length < MIN_MEMBERS || members.length > MAX_MEMBERS) {
            revert InvalidMemberCount(members.length);
        }
        if (optionCosts.length < MIN_OPTIONS || optionCosts.length > MAX_OPTIONS) {
            revert InvalidOptionCount(optionCosts.length);
        }
        if (submissionDeadline <= block.timestamp) {
            revert InvalidDeadline(submissionDeadline);
        }

        _validateMembers(members);
        _validateOptions(optionCosts);

        roomId = nextRoomId;
        nextRoomId += 1;

        Room storage room = rooms[roomId];
        room.exists = true;
        room.title = title;
        room.organizer = msg.sender;
        room.mode = mode;
        room.status = RoomStatus.CollectingInputs;
        room.submissionDeadline = submissionDeadline;
        room.memberCount = uint8(members.length);
        room.optionCount = uint8(optionCosts.length);
        room.aggregateCapacity = Nox.toEuint256(0);
        _restoreAggregateAcl(room);

        for (uint256 i = 0; i < members.length; i += 1) {
            address member = members[i];
            room.members.push(member);
            room.isMember[member] = true;
        }

        for (uint256 i = 0; i < optionCosts.length; i += 1) {
            uint256 optionCost = optionCosts[i];
            room.optionCosts.push(optionCost);

            euint256 encryptedOptionCost = Nox.toEuint256(optionCost);
            room.encryptedOptionCosts.push(encryptedOptionCost);
            Nox.allowThis(encryptedOptionCost);

            room.affordabilityHandles.push(ebool.wrap(bytes32(0)));
            room.affordabilityFinalized.push(false);
            room.publicAffordability.push(false);
        }

        emit RoomCreated(
            roomId,
            title,
            msg.sender,
            mode,
            submissionDeadline,
            room.memberCount,
            room.optionCount
        );
    }

    function submitPrivateCapacity(
        uint256 roomId,
        externalEuint256 externalHandle,
        bytes calldata inputProof
    ) external {
        Room storage room = _room(roomId);
        _requireQuietBudgetMode(room);

        if (room.status != RoomStatus.CollectingInputs) {
            revert RoomNotCollecting(room.status);
        }
        if (block.timestamp >= room.submissionDeadline) {
            revert SubmissionClosed(roomId);
        }
        if (!room.isMember[msg.sender]) {
            revert NotMember(msg.sender);
        }
        if (room.submitted[msg.sender]) {
            revert AlreadySubmitted(msg.sender);
        }

        euint256 capacity = Nox.fromExternal(externalHandle, inputProof);

        room.submitted[msg.sender] = true;
        room.submissionCount += 1;
        room.capacities[msg.sender] = capacity;
        _restoreCapacityAcl(room, msg.sender);

        room.aggregateCapacity = Nox.add(room.aggregateCapacity, capacity);
        _restoreAggregateAcl(room);

        emit CapacitySubmitted(roomId, msg.sender, room.submissionCount);

        if (room.submissionCount == room.memberCount) {
            _evaluateAffordability(roomId, room);
        }
    }

    function finalizeAffordability(
        uint256 roomId,
        uint256 optionIndex,
        bytes calldata publicDecryptionProof
    ) external {
        Room storage room = _room(roomId);
        _requireQuietBudgetMode(room);

        if (room.status != RoomStatus.ReadyForDecryption) {
            revert RoomNotReady(room.status);
        }
        _validateOptionIndex(room, optionIndex);
        if (room.affordabilityFinalized[optionIndex]) {
            revert AffordabilityAlreadyFinalized(optionIndex);
        }

        bool affordable = Nox.publicDecrypt(
            room.affordabilityHandles[optionIndex],
            publicDecryptionProof
        );

        room.affordabilityFinalized[optionIndex] = true;
        room.publicAffordability[optionIndex] = affordable;
        room.finalizedOptionCount += 1;

        emit AffordabilityFinalized(roomId, uint8(optionIndex), affordable);

        if (room.finalizedOptionCount == room.optionCount) {
            room.status = RoomStatus.Finalized;
            emit RoomFinalized(roomId);
        }
    }

    function cancelRoom(uint256 roomId) external {
        Room storage room = _room(roomId);

        if (msg.sender != room.organizer) {
            revert NotOrganizer(msg.sender);
        }

        if (room.mode == RoomMode.PrivateCircle) {
            if (room.collectionStatus != CollectionStatus.Open) {
                revert CollectionNotOpen(room.collectionStatus);
            }
            if (room.collectionCallbackReceived) {
                revert CollectionHasContributions(roomId);
            }

            room.collectionStatus = CollectionStatus.Cancelled;
            room.status = RoomStatus.Cancelled;
            emit PrivateCircleCancelled(roomId);
            emit RoomCancelled(roomId);
            return;
        }

        if (room.status != RoomStatus.CollectingInputs) {
            revert CancellationClosed(room.status);
        }

        room.status = RoomStatus.Cancelled;
        emit RoomCancelled(roomId);
    }

    function createFairSplitRoom(
        string calldata title,
        address[] calldata members,
        uint256 totalCost,
        uint64 submissionDeadline,
        SplitMethod splitMethod
    ) external returns (uint256 roomId) {
        if (members.length < MIN_MEMBERS || members.length > MAX_MEMBERS) {
            revert InvalidMemberCount(members.length);
        }
        if (totalCost == 0) {
            revert InvalidTotalCost(totalCost);
        }
        if (totalCost > MAX_SUPPORTED_AMOUNT) {
            revert AmountTooLarge(totalCost);
        }
        if (submissionDeadline <= block.timestamp) {
            revert InvalidDeadline(submissionDeadline);
        }

        _validateMembers(members);

        roomId = nextRoomId;
        nextRoomId += 1;

        Room storage room = rooms[roomId];
        room.exists = true;
        room.title = title;
        room.organizer = msg.sender;
        room.mode = RoomMode.FairSplit;
        room.status = RoomStatus.CollectingInputs;
        room.submissionDeadline = submissionDeadline;
        room.memberCount = uint8(members.length);
        room.splitMethod = splitMethod;
        room.splitTotalCost = totalCost;
        room.roundingRecipient = members[0];
        room.aggregateCapacity = Nox.toEuint256(0);
        _restoreAggregateAcl(room);
        room.encryptedSplitTotalCost = Nox.toEuint256(totalCost);
        Nox.allowThis(room.encryptedSplitTotalCost);

        for (uint256 i = 0; i < members.length; i += 1) {
            address member = members[i];
            room.members.push(member);
            room.isMember[member] = true;
        }

        if (splitMethod == SplitMethod.Equal) {
            _calculateEqualShares(room);
            room.splitSharesReady = true;
            room.status = RoomStatus.Finalized;
            emit SharesCalculated(roomId);
        } else if (splitMethod != SplitMethod.CapacityWeighted) {
            revert InvalidSplitMethod(splitMethod);
        }

        emit FairSplitRoomCreated(
            roomId,
            title,
            msg.sender,
            splitMethod,
            submissionDeadline,
            room.memberCount
        );
    }

    function submitSplitCapacity(
        uint256 roomId,
        externalEuint256 externalHandle,
        bytes calldata inputProof
    ) external {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.FairSplit);

        if (room.splitMethod != SplitMethod.CapacityWeighted) {
            revert SplitCapacitySubmissionNotAllowed(room.splitMethod);
        }
        if (room.status != RoomStatus.CollectingInputs) {
            revert RoomNotCollecting(room.status);
        }
        if (block.timestamp >= room.submissionDeadline) {
            revert SubmissionClosed(roomId);
        }
        if (!room.isMember[msg.sender]) {
            revert NotMember(msg.sender);
        }
        if (room.submitted[msg.sender]) {
            revert AlreadySubmitted(msg.sender);
        }

        euint256 capacity = Nox.fromExternal(externalHandle, inputProof);

        room.submitted[msg.sender] = true;
        room.submissionCount += 1;
        room.capacities[msg.sender] = capacity;
        _restoreCapacityAcl(room, msg.sender);

        room.aggregateCapacity = Nox.add(room.aggregateCapacity, capacity);
        _restoreAggregateAcl(room);

        emit SplitCapacitySubmitted(roomId, msg.sender, room.submissionCount);

        if (room.submissionCount == room.memberCount) {
            _evaluateSplitFeasibility(roomId, room);
        }
    }

    function finalizeSplitFeasibility(
        uint256 roomId,
        bytes calldata publicDecryptionProof
    ) external {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.FairSplit);

        if (room.splitMethod != SplitMethod.CapacityWeighted) {
            revert InvalidSplitMethod(room.splitMethod);
        }
        if (room.status != RoomStatus.ReadyForDecryption) {
            revert RoomNotReady(room.status);
        }
        if (room.splitFeasibilityFinalized) {
            revert SplitFeasibilityAlreadyFinalized();
        }
        if (!Nox.isInitialized(room.splitFeasibilityHandle)) {
            revert SplitFeasibilityNotReady();
        }

        bool feasible = Nox.publicDecrypt(room.splitFeasibilityHandle, publicDecryptionProof);

        room.splitFeasibilityFinalized = true;
        room.publicSplitFeasible = feasible;

        emit SplitFeasibilityFinalized(roomId, feasible);

        if (!feasible) {
            room.status = RoomStatus.Finalized;
            emit RoomFinalized(roomId);
            return;
        }

        if (room.splitTotalCost > 0 && !Nox.isInitialized(room.aggregateCapacity)) {
            revert ZeroAggregateCapacity(roomId);
        }

        _calculateWeightedShares(room);
        room.splitSharesReady = true;
        room.status = RoomStatus.Finalized;

        emit SharesCalculated(roomId);
        emit RoomFinalized(roomId);
    }

    function createPrivateCircleRoom(
        string calldata title,
        address confidentialToken,
        address recipient,
        uint256 publicTarget,
        uint64 deadline,
        CollectionAccess access,
        address[] calldata invitedMembers
    ) external returns (uint256 roomId) {
        _validateConfidentialToken(confidentialToken);
        if (recipient == address(0)) {
            revert InvalidRecipient(recipient);
        }
        if (publicTarget > MAX_SUPPORTED_AMOUNT) {
            revert InvalidTarget(publicTarget);
        }
        if (deadline <= block.timestamp) {
            revert InvalidDeadline(deadline);
        }
        if (access == CollectionAccess.InviteOnly) {
            if (invitedMembers.length < MIN_MEMBERS || invitedMembers.length > MAX_MEMBERS) {
                revert InvalidCollectionMembers(invitedMembers.length);
            }
            _validateMembers(invitedMembers);
        } else if (invitedMembers.length != 0) {
            revert InvalidCollectionMembers(invitedMembers.length);
        }

        roomId = nextRoomId;
        nextRoomId += 1;

        Room storage room = rooms[roomId];
        room.exists = true;
        room.title = title;
        room.organizer = msg.sender;
        room.mode = RoomMode.PrivateCircle;
        room.status = RoomStatus.CollectingInputs;
        room.submissionDeadline = deadline;
        room.memberCount = uint8(invitedMembers.length);
        room.collectionAccess = access;
        room.collectionStatus = CollectionStatus.Open;
        room.confidentialToken = confidentialToken;
        room.recipient = recipient;
        room.publicTarget = publicTarget;
        room.collectionAggregate = Nox.toEuint256(0);
        _restoreCollectionAggregateAcl(room);

        if (publicTarget != 0) {
            room.encryptedTarget = Nox.toEuint256(publicTarget);
            Nox.allowThis(room.encryptedTarget);
        }

        for (uint256 i = 0; i < invitedMembers.length; i += 1) {
            address member = invitedMembers[i];
            room.members.push(member);
            room.isMember[member] = true;
        }

        emit PrivateCircleCreated(
            roomId,
            title,
            msg.sender,
            confidentialToken,
            recipient,
            access,
            deadline,
            publicTarget != 0
        );
    }

    function onConfidentialTransferReceived(
        address,
        address from,
        euint256 actualTransferredAmount,
        bytes calldata data
    ) external returns (ebool) {
        if (data.length != 32) {
            revert InvalidCallbackData();
        }

        uint256 roomId = abi.decode(data, (uint256));
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);

        if (msg.sender != room.confidentialToken) {
            revert UnauthorizedCallbackToken(msg.sender);
        }
        if (room.collectionStatus != CollectionStatus.Open) {
            revert CollectionNotOpen(room.collectionStatus);
        }
        if (block.timestamp >= room.submissionDeadline) {
            revert SubmissionClosed(roomId);
        }
        if (room.collectionAccess == CollectionAccess.InviteOnly && !room.isMember[from]) {
            revert NotMember(from);
        }

        euint256 encryptedZero = Nox.toEuint256(0);
        Nox.allowThis(encryptedZero);
        ebool positive = Nox.gt(actualTransferredAmount, encryptedZero);
        euint256 effectiveAmount = Nox.select(positive, actualTransferredAmount, encryptedZero);

        uint256 contributionId = nextContributionId;
        nextContributionId += 1;

        room.collectionCallbackReceived = true;
        room.cumulativeContributions[from] = Nox.add(
            room.cumulativeContributions[from],
            effectiveAmount
        );
        _restoreCumulativeContributionAcl(room, from);

        room.collectionAggregate = Nox.add(room.collectionAggregate, effectiveAmount);
        _restoreCollectionAggregateAcl(room);

        contributions[contributionId] = Contribution({
            exists: true,
            roomId: roomId,
            contributor: from,
            receipt: effectiveAmount,
            positiveHandle: positive,
            finalized: false,
            accepted: false
        });
        _restoreContributionReceiptAcl(contributions[contributionId]);
        Nox.allowThis(positive);
        Nox.allowPublicDecryption(positive);

        if (room.publicTarget != 0) {
            _updateCollectionTarget(roomId, room);
        }

        Nox.allowTransient(positive, msg.sender);

        emit ContributionReceived(roomId, contributionId, from);
        return positive;
    }

    function finalizeContribution(
        uint256 contributionId,
        bytes calldata publicDecryptionProof
    ) external {
        Contribution storage contribution = _contribution(contributionId);
        if (contribution.finalized) {
            revert ContributionAlreadyFinalized(contributionId);
        }

        bool accepted = Nox.publicDecrypt(contribution.positiveHandle, publicDecryptionProof);
        Room storage room = _room(contribution.roomId);

        contribution.finalized = true;
        contribution.accepted = accepted;

        if (accepted) {
            room.verifiedContributionCount += 1;
            if (!room.hasVerifiedContribution[contribution.contributor]) {
                room.hasVerifiedContribution[contribution.contributor] = true;
                room.uniqueContributorCount += 1;
            }
        }

        emit ContributionFinalized(
            contribution.roomId,
            contributionId,
            contribution.contributor,
            accepted,
            room.verifiedContributionCount,
            room.uniqueContributorCount
        );
    }

    function finalizeCollectionTarget(
        uint256 roomId,
        bytes calldata publicDecryptionProof
    ) external {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        if (room.publicTarget == 0) {
            revert TargetNotConfigured(roomId);
        }
        if (!Nox.isInitialized(room.collectionTargetHandle)) {
            revert TargetNotReady(roomId);
        }
        if (room.collectionTargetFinalized && room.finalizedTargetVersion == room.collectionTargetVersion) {
            revert TargetAlreadyFinalized(roomId, room.collectionTargetVersion);
        }

        bool reached = Nox.publicDecrypt(room.collectionTargetHandle, publicDecryptionProof);

        room.collectionTargetFinalized = true;
        room.finalizedTargetVersion = room.collectionTargetVersion;
        room.publicTargetReached = reached;

        emit CollectionTargetFinalized(roomId, room.collectionTargetVersion, reached);
    }

    function closePrivateCircle(uint256 roomId) external {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        if (msg.sender != room.organizer) {
            revert NotOrganizer(msg.sender);
        }
        if (room.collectionStatus != CollectionStatus.Open) {
            revert CollectionNotOpen(room.collectionStatus);
        }

        room.collectionStatus = CollectionStatus.Closed;
        room.status = RoomStatus.ReadyForDecryption;
        emit PrivateCircleClosed(roomId);
    }

    function requestCollectionWithdrawal(uint256 roomId) external nonReentrant {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        if (msg.sender != room.organizer) {
            revert NotOrganizer(msg.sender);
        }
        if (room.withdrawalRequested) {
            revert WithdrawalAlreadyRequested(roomId);
        }
        if (
            room.collectionStatus != CollectionStatus.Closed &&
            block.timestamp < room.submissionDeadline
        ) {
            revert WithdrawalNotAllowed(roomId);
        }
        if (room.collectionStatus == CollectionStatus.Cancelled || room.collectionStatus == CollectionStatus.Withdrawn) {
            revert WithdrawalNotAllowed(roomId);
        }
        if (room.verifiedContributionCount == 0) {
            revert ZeroContributionCollection(roomId);
        }

        room.withdrawalRequested = true;
        room.collectionStatus = CollectionStatus.WithdrawalPending;
        room.status = RoomStatus.ReadyForDecryption;

        Nox.allowTransient(room.collectionAggregate, room.confidentialToken);
        euint256 actualTransferred = IERC7984(room.confidentialToken).confidentialTransfer(
            room.recipient,
            room.collectionAggregate
        );
        room.withdrawalHandle = actualTransferred;
        _restoreWithdrawalAcl(room);

        ebool success = Nox.eq(actualTransferred, room.collectionAggregate);
        room.withdrawalSuccessHandle = success;
        Nox.allowThis(success);
        Nox.allowPublicDecryption(success);

        emit CollectionWithdrawalRequested(roomId, room.recipient);
    }

    function finalizeCollectionWithdrawal(
        uint256 roomId,
        bytes calldata publicDecryptionProof
    ) external {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        if (!room.withdrawalRequested) {
            revert WithdrawalNotRequested(roomId);
        }
        if (room.withdrawalFinalized) {
            revert WithdrawalAlreadyFinalized(roomId);
        }

        bool success = Nox.publicDecrypt(room.withdrawalSuccessHandle, publicDecryptionProof);
        if (!success) {
            revert WithdrawalFailed(roomId);
        }

        room.withdrawalFinalized = true;
        room.collectionStatus = CollectionStatus.Withdrawn;
        room.status = RoomStatus.Finalized;
        room.collectionAggregate = Nox.toEuint256(0);
        _restoreCollectionAggregateAcl(room);

        emit CollectionWithdrawn(roomId, room.recipient);
        emit RoomFinalized(roomId);
    }

    function getRoom(uint256 roomId) external view returns (RoomView memory) {
        Room storage room = _room(roomId);
        return
            RoomView({
                id: roomId,
                title: room.title,
                organizer: room.organizer,
                mode: room.mode,
                status: room.status,
                submissionDeadline: room.submissionDeadline,
                memberCount: room.memberCount,
                submissionCount: room.submissionCount,
                optionCount: room.optionCount,
                finalizedOptionCount: room.finalizedOptionCount
            });
    }

    function getMembers(uint256 roomId) external view returns (address[] memory) {
        return _room(roomId).members;
    }

    function getOptions(uint256 roomId) external view returns (uint256[] memory) {
        return _room(roomId).optionCosts;
    }

    function isMember(uint256 roomId, address account) external view returns (bool) {
        return _room(roomId).isMember[account];
    }

    function hasSubmitted(uint256 roomId, address account) external view returns (bool) {
        return _room(roomId).submitted[account];
    }

    function getMyCapacityHandle(uint256 roomId) external view returns (euint256) {
        Room storage room = _room(roomId);
        if (!room.submitted[msg.sender]) {
            revert CapacityNotSubmitted(msg.sender);
        }
        return room.capacities[msg.sender];
    }

    function getAggregateCapacityHandle(uint256 roomId) external view returns (euint256) {
        return _room(roomId).aggregateCapacity;
    }

    function getAffordabilityHandle(
        uint256 roomId,
        uint256 optionIndex
    ) external view returns (ebool) {
        Room storage room = _room(roomId);
        _validateOptionIndex(room, optionIndex);
        return room.affordabilityHandles[optionIndex];
    }

    function getPublicAffordability(
        uint256 roomId,
        uint256 optionIndex
    ) external view returns (bool finalized, bool affordable) {
        Room storage room = _room(roomId);
        _validateOptionIndex(room, optionIndex);
        return (room.affordabilityFinalized[optionIndex], room.publicAffordability[optionIndex]);
    }

    function getSplitMethod(uint256 roomId) external view returns (SplitMethod) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.FairSplit);
        return room.splitMethod;
    }

    function getSplitTotalCost(uint256 roomId) external view returns (uint256) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.FairSplit);
        return room.splitTotalCost;
    }

    function getSplitFeasibilityHandle(uint256 roomId) external view returns (ebool) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.FairSplit);
        return room.splitFeasibilityHandle;
    }

    function getPublicSplitFeasibility(
        uint256 roomId
    ) external view returns (bool finalized, bool feasible) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.FairSplit);
        return (room.splitFeasibilityFinalized, room.publicSplitFeasible);
    }

    function getMySplitCapacityHandle(uint256 roomId) external view returns (euint256) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.FairSplit);
        if (room.splitMethod != SplitMethod.CapacityWeighted) {
            revert SplitCapacitySubmissionNotAllowed(room.splitMethod);
        }
        if (!room.submitted[msg.sender]) {
            revert CapacityNotSubmitted(msg.sender);
        }
        return room.capacities[msg.sender];
    }

    function getMyShareHandle(uint256 roomId) external view returns (euint256) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.FairSplit);
        if (!room.splitSharesReady) {
            revert SharesNotReady(roomId);
        }
        if (!room.isMember[msg.sender]) {
            revert NotMember(msg.sender);
        }
        return room.shares[msg.sender];
    }

    function getShareHandleForTesting(
        uint256 roomId,
        address member
    ) external view returns (euint256) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.FairSplit);
        if (!room.splitSharesReady) {
            revert SharesNotReady(roomId);
        }
        if (!room.isMember[member]) {
            revert NotMember(member);
        }
        return room.shares[member];
    }

    function sharesReady(uint256 roomId) external view returns (bool) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.FairSplit);
        return room.splitSharesReady;
    }

    function getRoundingRecipient(uint256 roomId) external view returns (address) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.FairSplit);
        return room.roundingRecipient;
    }

    function getPrivateCircle(uint256 roomId) external view returns (PrivateCircleView memory) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        return
            PrivateCircleView({
                id: roomId,
                title: room.title,
                organizer: room.organizer,
                confidentialToken: room.confidentialToken,
                recipient: room.recipient,
                publicTarget: room.publicTarget,
                deadline: room.submissionDeadline,
                access: room.collectionAccess,
                collectionStatus: room.collectionStatus,
                verifiedContributionCount: room.verifiedContributionCount,
                uniqueContributorCount: room.uniqueContributorCount,
                targetVersion: room.collectionTargetVersion
            });
    }

    function getContribution(
        uint256 contributionId
    ) external view returns (ContributionView memory) {
        Contribution storage contribution = _contribution(contributionId);
        return
            ContributionView({
                id: contributionId,
                roomId: contribution.roomId,
                contributor: contribution.contributor,
                finalized: contribution.finalized,
                accepted: contribution.accepted
            });
    }

    function getContributionPositivityHandle(uint256 contributionId) external view returns (ebool) {
        return _contribution(contributionId).positiveHandle;
    }

    function getMyContributionHandle(uint256 contributionId) external view returns (euint256) {
        Contribution storage contribution = _contribution(contributionId);
        if (msg.sender != contribution.contributor) {
            revert NotContributor(msg.sender);
        }
        return contribution.receipt;
    }

    function getMyCumulativeContributionHandle(uint256 roomId) external view returns (euint256) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        if (!Nox.isInitialized(room.cumulativeContributions[msg.sender])) {
            revert ContributionNotAvailable(msg.sender);
        }
        return room.cumulativeContributions[msg.sender];
    }

    function getCollectionAggregateHandle(uint256 roomId) external view returns (euint256) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        return room.collectionAggregate;
    }

    function getVerifiedContributionCount(uint256 roomId) external view returns (uint256) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        return room.verifiedContributionCount;
    }

    function getUniqueContributorCount(uint256 roomId) external view returns (uint256) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        return room.uniqueContributorCount;
    }

    function hasVerifiedContribution(
        uint256 roomId,
        address account
    ) external view returns (bool) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        return room.hasVerifiedContribution[account];
    }

    function getCollectionTargetHandle(uint256 roomId) external view returns (ebool) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        if (room.publicTarget == 0) {
            revert TargetNotConfigured(roomId);
        }
        return room.collectionTargetHandle;
    }

    function getCollectionTargetVersion(uint256 roomId) external view returns (uint64) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        return room.collectionTargetVersion;
    }

    function getPublicTargetStatus(
        uint256 roomId
    ) external view returns (bool finalized, bool reached, uint64 version) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        return (
            room.collectionTargetFinalized && room.finalizedTargetVersion == room.collectionTargetVersion,
            room.publicTargetReached,
            room.collectionTargetVersion
        );
    }

    function getWithdrawalHandle(uint256 roomId) external view returns (euint256) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        return room.withdrawalHandle;
    }

    function getWithdrawalSuccessHandle(uint256 roomId) external view returns (ebool) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        return room.withdrawalSuccessHandle;
    }

    function isSplitFeasibilityPubliclyDecryptable(
        uint256 roomId
    ) external view returns (bool) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.FairSplit);
        return Nox.isPubliclyDecryptable(room.splitFeasibilityHandle);
    }

    function isSplitFeasibilityAllowed(
        uint256 roomId,
        address account
    ) external view returns (bool) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.FairSplit);
        return Nox.isAllowed(room.splitFeasibilityHandle, account);
    }

    function isShareAllowed(
        uint256 roomId,
        address member,
        address account
    ) external view returns (bool) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.FairSplit);
        if (!room.splitSharesReady) {
            revert SharesNotReady(roomId);
        }
        if (!room.isMember[member]) {
            revert NotMember(member);
        }
        return Nox.isAllowed(room.shares[member], account);
    }

    function isCapacityAllowed(
        uint256 roomId,
        address member,
        address account
    ) external view returns (bool) {
        Room storage room = _room(roomId);
        if (!room.submitted[member]) {
            revert CapacityNotSubmitted(member);
        }
        return Nox.isAllowed(room.capacities[member], account);
    }

    function isAggregateAllowed(uint256 roomId, address account) external view returns (bool) {
        return Nox.isAllowed(_room(roomId).aggregateCapacity, account);
    }

    function isAffordabilityAllowed(
        uint256 roomId,
        uint256 optionIndex,
        address account
    ) external view returns (bool) {
        Room storage room = _room(roomId);
        _validateOptionIndex(room, optionIndex);
        return Nox.isAllowed(room.affordabilityHandles[optionIndex], account);
    }

    function isAffordabilityPubliclyDecryptable(
        uint256 roomId,
        uint256 optionIndex
    ) external view returns (bool) {
        Room storage room = _room(roomId);
        _validateOptionIndex(room, optionIndex);
        return Nox.isPubliclyDecryptable(room.affordabilityHandles[optionIndex]);
    }

    function isCollectionAggregateAllowed(
        uint256 roomId,
        address account
    ) external view returns (bool) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        return Nox.isAllowed(room.collectionAggregate, account);
    }

    function isCumulativeContributionAllowed(
        uint256 roomId,
        address contributor,
        address account
    ) external view returns (bool) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        if (!Nox.isInitialized(room.cumulativeContributions[contributor])) {
            revert ContributionNotAvailable(contributor);
        }
        return Nox.isAllowed(room.cumulativeContributions[contributor], account);
    }

    function isContributionReceiptAllowed(
        uint256 contributionId,
        address account
    ) external view returns (bool) {
        Contribution storage contribution = _contribution(contributionId);
        return Nox.isAllowed(contribution.receipt, account);
    }

    function isContributionPositivityPubliclyDecryptable(
        uint256 contributionId
    ) external view returns (bool) {
        return Nox.isPubliclyDecryptable(_contribution(contributionId).positiveHandle);
    }

    function isCollectionTargetPubliclyDecryptable(
        uint256 roomId
    ) external view returns (bool) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        return Nox.isPubliclyDecryptable(room.collectionTargetHandle);
    }

    function isWithdrawalSuccessPubliclyDecryptable(
        uint256 roomId
    ) external view returns (bool) {
        Room storage room = _room(roomId);
        _requireRoomMode(room, RoomMode.PrivateCircle);
        return Nox.isPubliclyDecryptable(room.withdrawalSuccessHandle);
    }

    function _evaluateAffordability(uint256 roomId, Room storage room) private {
        room.status = RoomStatus.ReadyForDecryption;

        for (uint256 i = 0; i < room.optionCount; i += 1) {
            ebool result = Nox.ge(room.aggregateCapacity, room.encryptedOptionCosts[i]);
            room.affordabilityHandles[i] = result;
            Nox.allowThis(result);
            Nox.allowPublicDecryption(result);

            emit AffordabilityReady(roomId, uint8(i));
        }
    }

    function _evaluateSplitFeasibility(uint256 roomId, Room storage room) private {
        room.status = RoomStatus.ReadyForDecryption;
        ebool result = Nox.ge(room.aggregateCapacity, room.encryptedSplitTotalCost);
        room.splitFeasibilityHandle = result;
        Nox.allowThis(result);
        Nox.allowPublicDecryption(result);

        emit SplitFeasibilityReady(roomId);
    }

    function _calculateEqualShares(Room storage room) private {
        uint256 baseShare = room.splitTotalCost / room.memberCount;
        uint256 remainder = room.splitTotalCost % room.memberCount;

        for (uint256 i = 0; i < room.memberCount; i += 1) {
            address member = room.members[i];
            uint256 share = baseShare;
            if (i == 0) {
                share += remainder;
            }

            euint256 publicShare = Nox.toEuint256(share);
            euint256 privateShare = Nox.add(publicShare, Nox.toEuint256(0));
            room.shares[member] = privateShare;
            _restoreShareAcl(room, member);
        }
    }

    function _calculateWeightedShares(Room storage room) private {
        euint256 encryptedShareSum = Nox.toEuint256(0);
        Nox.allowThis(encryptedShareSum);

        for (uint256 i = 0; i < room.memberCount; i += 1) {
            address member = room.members[i];

            euint256 weightedCapacity = Nox.mul(
                room.capacities[member],
                room.encryptedSplitTotalCost
            );
            Nox.allowThis(weightedCapacity);

            euint256 share = Nox.div(weightedCapacity, room.aggregateCapacity);
            room.shares[member] = share;
            _restoreShareAcl(room, member);

            encryptedShareSum = Nox.add(encryptedShareSum, share);
            Nox.allowThis(encryptedShareSum);
        }

        euint256 remainder = Nox.sub(room.encryptedSplitTotalCost, encryptedShareSum);
        Nox.allowThis(remainder);

        address roundingRecipient = room.roundingRecipient;
        room.shares[roundingRecipient] = Nox.add(room.shares[roundingRecipient], remainder);
        _restoreShareAcl(room, roundingRecipient);
    }

    function _updateCollectionTarget(uint256 roomId, Room storage room) private {
        ebool result = Nox.ge(room.collectionAggregate, room.encryptedTarget);
        room.collectionTargetHandle = result;
        room.collectionTargetVersion += 1;
        room.collectionTargetFinalized = false;
        Nox.allowThis(result);
        Nox.allowPublicDecryption(result);

        emit CollectionTargetReady(roomId, room.collectionTargetVersion);
    }

    function _restoreCapacityAcl(Room storage room, address member) private {
        euint256 capacity = room.capacities[member];
        Nox.allowThis(capacity);
        Nox.allow(capacity, member);
    }

    function _restoreAggregateAcl(Room storage room) private {
        Nox.allowThis(room.aggregateCapacity);
    }

    function _restoreShareAcl(Room storage room, address member) private {
        euint256 share = room.shares[member];
        Nox.allowThis(share);
        Nox.allow(share, member);
    }

    function _restoreCollectionAggregateAcl(Room storage room) private {
        Nox.allowThis(room.collectionAggregate);
        Nox.allow(room.collectionAggregate, room.organizer);
    }

    function _restoreCumulativeContributionAcl(Room storage room, address contributor) private {
        euint256 cumulative = room.cumulativeContributions[contributor];
        Nox.allowThis(cumulative);
        Nox.allow(cumulative, contributor);
    }

    function _restoreContributionReceiptAcl(Contribution storage contribution) private {
        Nox.allowThis(contribution.receipt);
        Nox.allow(contribution.receipt, contribution.contributor);
    }

    function _restoreWithdrawalAcl(Room storage room) private {
        Nox.allowThis(room.withdrawalHandle);
        Nox.allow(room.withdrawalHandle, room.organizer);
        Nox.allow(room.withdrawalHandle, room.recipient);
    }

    function _validateConfidentialToken(address token) private view {
        if (token.code.length == 0) {
            revert InvalidToken(token);
        }
        try IERC165(token).supportsInterface(type(IERC7984).interfaceId) returns (bool supported) {
            if (!supported) {
                revert InvalidToken(token);
            }
        } catch {
            revert InvalidToken(token);
        }
    }

    function _requireRoomMode(Room storage room, RoomMode expected) private view {
        if (room.mode != expected) {
            revert WrongRoomMode(expected, room.mode);
        }
    }

    function _requireQuietBudgetMode(Room storage room) private view {
        if (room.mode != RoomMode.QuietBudget && room.mode != RoomMode.PlanTogether) {
            revert WrongRoomMode(RoomMode.QuietBudget, room.mode);
        }
    }

    function _room(uint256 roomId) private view returns (Room storage room) {
        room = rooms[roomId];
        if (!room.exists) {
            revert InvalidRoomId(roomId);
        }
    }

    function _contribution(uint256 contributionId) private view returns (Contribution storage contribution) {
        contribution = contributions[contributionId];
        if (!contribution.exists) {
            revert InvalidContributionId(contributionId);
        }
    }

    function _validateOptionIndex(Room storage room, uint256 optionIndex) private view {
        if (optionIndex >= room.optionCount) {
            revert InvalidOptionIndex(optionIndex);
        }
    }

    function _validateMembers(address[] calldata members) private pure {
        for (uint256 i = 0; i < members.length; i += 1) {
            address member = members[i];
            if (member == address(0)) {
                revert InvalidMember(member);
            }

            for (uint256 j = i + 1; j < members.length; j += 1) {
                if (member == members[j]) {
                    revert DuplicateMember(member);
                }
            }
        }
    }

    function _validateOptions(uint256[] calldata optionCosts) private pure {
        for (uint256 i = 0; i < optionCosts.length; i += 1) {
            uint256 optionCost = optionCosts[i];
            if (optionCost == 0) {
                revert InvalidOptionCost(optionCost);
            }

            for (uint256 j = i + 1; j < optionCosts.length; j += 1) {
                if (optionCost == optionCosts[j]) {
                    revert DuplicateOptionCost(optionCost);
                }
            }
        }
    }
}
