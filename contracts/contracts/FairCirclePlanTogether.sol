// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {IERC7984} from "@iexec-nox/nox-confidential-contracts/contracts/interfaces/IERC7984.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IFairCircleCore} from "./interfaces/IFairCircleCore.sol";

contract FairCirclePlanTogether {
    uint8 private constant MIN_MEMBERS = 2;
    uint8 private constant MAX_MEMBERS = 8;
    uint8 private constant MAX_OPTIONS = 4;

    enum Stage {
        Budget,
        Split,
        Collection,
        Complete,
        Cancelled
    }

    struct PlanView {
        uint256 id;
        string title;
        address organizer;
        Stage stage;
        uint256 budgetRoomId;
        uint256 selectedOptionIndex;
        uint256 selectedCost;
        IFairCircleCore.SplitMethod splitMethod;
        uint256 splitRoomId;
        uint256 collectionRoomId;
        address intendedRecipient;
        uint64 createdAt;
        uint64 updatedAt;
    }

    struct Plan {
        bool exists;
        string title;
        address organizer;
        Stage stage;
        uint256 budgetRoomId;
        uint256 selectedOptionIndex;
        uint256 selectedCost;
        IFairCircleCore.SplitMethod splitMethod;
        uint256 splitRoomId;
        uint256 collectionRoomId;
        address intendedRecipient;
        uint64 createdAt;
        uint64 updatedAt;
        address[] members;
        uint256[] options;
        mapping(address account => bool) isMember;
    }

    IFairCircleCore public immutable fairCircleCore;
    address public immutable approvedConfidentialToken;
    uint256 public nextPlanId = 1;

    mapping(uint256 planId => Plan) private plans;
    mapping(uint256 roomId => uint256 planId) private linkedPlanForRoom;

    error InvalidCore(address core);
    error InvalidToken(address token);
    error InvalidRecipient(address recipient);
    error InvalidPlanId(uint256 planId);
    error WrongStage(Stage expected, Stage actual);
    error NotOrganizer(address caller);
    error InvalidBudgetRoom(uint256 roomId);
    error InvalidMemberCount(uint256 count);
    error RoomAlreadyLinked(uint256 roomId, uint256 planId);
    error InvalidOptionIndex(uint256 optionIndex);
    error OptionNotFinalized(uint256 planId, uint256 optionIndex);
    error OptionNotAffordable(uint256 planId, uint256 optionIndex);
    error InvalidSelectedCost(uint256 cost);
    error SplitRoomAlreadyLinked(uint256 planId);
    error CollectionRoomAlreadyLinked(uint256 planId);
    error InvalidChildRoom(uint256 roomId);
    error OrganizerMismatch(address expected, address actual);
    error MemberMismatch(uint256 index, address expected, address actual);
    error MemberCountMismatch(uint256 expected, uint256 actual);
    error SplitMethodMismatch(IFairCircleCore.SplitMethod expected, IFairCircleCore.SplitMethod actual);
    error CostMismatch(uint256 expected, uint256 actual);
    error SplitRoomNotLinked(uint256 planId);
    error SplitNotReady(uint256 roomId);
    error SplitNotFeasible(uint256 roomId);
    error TokenMismatch(address expected, address actual);
    error RecipientMismatch(address expected, address actual);
    error TargetMismatch(uint256 expected, uint256 actual);
    error CollectionAccessMismatch(IFairCircleCore.CollectionAccess actual);
    error CollectionRoomNotLinked(uint256 planId);
    error CollectionNotWithdrawn(uint256 roomId);
    error CancellationClosed(Stage stage);

    event PlanCreated(
        uint256 indexed planId,
        uint256 indexed budgetRoomId,
        address indexed organizer,
        string title,
        IFairCircleCore.SplitMethod splitMethod,
        address intendedRecipient,
        Stage stage
    );
    event AffordableOptionSelected(
        uint256 indexed planId,
        uint256 indexed budgetRoomId,
        uint256 indexed optionIndex,
        uint256 selectedCost,
        Stage stage
    );
    event FairSplitRoomLinked(
        uint256 indexed planId,
        uint256 indexed splitRoomId,
        IFairCircleCore.SplitMethod splitMethod,
        uint256 selectedCost,
        Stage stage
    );
    event FairSplitConfirmed(uint256 indexed planId, uint256 indexed splitRoomId, Stage stage);
    event PrivateCircleRoomLinked(
        uint256 indexed planId,
        uint256 indexed collectionRoomId,
        address indexed recipient,
        uint256 selectedCost,
        Stage stage
    );
    event PlanCompleted(uint256 indexed planId, uint256 indexed collectionRoomId, Stage stage);
    event PlanCancelled(uint256 indexed planId, Stage stage);

    constructor(address fairCircleCore_, address approvedConfidentialToken_) {
        if (fairCircleCore_.code.length == 0) {
            revert InvalidCore(fairCircleCore_);
        }
        _validateConfidentialToken(approvedConfidentialToken_);

        fairCircleCore = IFairCircleCore(fairCircleCore_);
        approvedConfidentialToken = approvedConfidentialToken_;
    }

    function createPlanFromBudgetRoom(
        uint256 budgetRoomId,
        IFairCircleCore.SplitMethod intendedSplitMethod,
        address intendedRecipient
    ) external returns (uint256 planId) {
        if (intendedRecipient == address(0)) {
            revert InvalidRecipient(intendedRecipient);
        }
        _requireUnlinkedRoom(budgetRoomId);

        IFairCircleCore.RoomView memory room = fairCircleCore.getRoom(budgetRoomId);
        if (room.mode != IFairCircleCore.RoomMode.PlanTogether) {
            revert InvalidBudgetRoom(budgetRoomId);
        }
        if (room.organizer != msg.sender) {
            revert NotOrganizer(msg.sender);
        }
        if (room.memberCount < MIN_MEMBERS || room.memberCount > MAX_MEMBERS) {
            revert InvalidMemberCount(room.memberCount);
        }

        address[] memory members = fairCircleCore.getMembers(budgetRoomId);
        uint256[] memory options = fairCircleCore.getOptions(budgetRoomId);
        if (members.length != room.memberCount) {
            revert MemberCountMismatch(room.memberCount, members.length);
        }
        if (options.length == 0 || options.length > MAX_OPTIONS) {
            revert InvalidOptionIndex(options.length);
        }

        planId = nextPlanId;
        nextPlanId += 1;

        Plan storage plan = plans[planId];
        plan.exists = true;
        plan.title = room.title;
        plan.organizer = msg.sender;
        plan.stage = Stage.Budget;
        plan.budgetRoomId = budgetRoomId;
        plan.splitMethod = intendedSplitMethod;
        plan.intendedRecipient = intendedRecipient;
        plan.createdAt = uint64(block.timestamp);
        plan.updatedAt = uint64(block.timestamp);

        for (uint256 i = 0; i < members.length; i += 1) {
            address member = members[i];
            plan.members.push(member);
            plan.isMember[member] = true;
        }
        for (uint256 i = 0; i < options.length; i += 1) {
            plan.options.push(options[i]);
        }

        linkedPlanForRoom[budgetRoomId] = planId;

        emit PlanCreated(
            planId,
            budgetRoomId,
            msg.sender,
            room.title,
            intendedSplitMethod,
            intendedRecipient,
            Stage.Budget
        );
    }

    function selectAffordableOption(uint256 planId, uint256 optionIndex) external {
        Plan storage plan = _plan(planId);
        _requireOrganizer(plan);
        _requireStage(plan, Stage.Budget);

        IFairCircleCore.RoomView memory budgetRoom = fairCircleCore.getRoom(plan.budgetRoomId);
        if (budgetRoom.status != IFairCircleCore.RoomStatus.Finalized) {
            revert WrongStage(Stage.Split, plan.stage);
        }
        if (optionIndex >= plan.options.length) {
            revert InvalidOptionIndex(optionIndex);
        }

        (bool finalized, bool affordable) = fairCircleCore.getPublicAffordability(
            plan.budgetRoomId,
            optionIndex
        );
        if (!finalized) {
            revert OptionNotFinalized(planId, optionIndex);
        }
        if (!affordable) {
            revert OptionNotAffordable(planId, optionIndex);
        }

        uint256 selectedCost = plan.options[optionIndex];
        if (selectedCost == 0) {
            revert InvalidSelectedCost(selectedCost);
        }

        plan.selectedOptionIndex = optionIndex;
        plan.selectedCost = selectedCost;
        _setStage(plan, Stage.Split);

        emit AffordableOptionSelected(
            planId,
            plan.budgetRoomId,
            optionIndex,
            selectedCost,
            Stage.Split
        );
    }

    function linkFairSplitRoom(uint256 planId, uint256 splitRoomId) external {
        Plan storage plan = _plan(planId);
        _requireOrganizer(plan);
        _requireStage(plan, Stage.Split);
        if (plan.splitRoomId != 0) {
            revert SplitRoomAlreadyLinked(planId);
        }
        _requireUnlinkedRoom(splitRoomId);

        IFairCircleCore.RoomView memory splitRoom = fairCircleCore.getRoom(splitRoomId);
        if (splitRoom.mode != IFairCircleCore.RoomMode.FairSplit) {
            revert InvalidChildRoom(splitRoomId);
        }
        _requireOrganizerMatch(plan.organizer, splitRoom.organizer);
        _requireMembersMatch(plan, splitRoomId);

        IFairCircleCore.SplitMethod actualMethod = fairCircleCore.getSplitMethod(splitRoomId);
        if (actualMethod != plan.splitMethod) {
            revert SplitMethodMismatch(plan.splitMethod, actualMethod);
        }

        uint256 actualCost = fairCircleCore.getSplitTotalCost(splitRoomId);
        if (actualCost != plan.selectedCost) {
            revert CostMismatch(plan.selectedCost, actualCost);
        }

        plan.splitRoomId = splitRoomId;
        plan.updatedAt = uint64(block.timestamp);
        linkedPlanForRoom[splitRoomId] = planId;

        emit FairSplitRoomLinked(
            planId,
            splitRoomId,
            actualMethod,
            actualCost,
            Stage.Split
        );
    }

    function confirmSplitReady(uint256 planId) external {
        Plan storage plan = _plan(planId);
        _requireStage(plan, Stage.Split);
        if (plan.splitRoomId == 0) {
            revert SplitRoomNotLinked(planId);
        }
        if (!fairCircleCore.sharesReady(plan.splitRoomId)) {
            revert SplitNotReady(plan.splitRoomId);
        }
        if (plan.splitMethod == IFairCircleCore.SplitMethod.CapacityWeighted) {
            (bool finalized, bool feasible) = fairCircleCore.getPublicSplitFeasibility(
                plan.splitRoomId
            );
            if (!finalized) {
                revert SplitNotReady(plan.splitRoomId);
            }
            if (!feasible) {
                revert SplitNotFeasible(plan.splitRoomId);
            }
        }

        _setStage(plan, Stage.Collection);
        emit FairSplitConfirmed(planId, plan.splitRoomId, Stage.Collection);
    }

    function linkPrivateCircleRoom(uint256 planId, uint256 collectionRoomId) external {
        Plan storage plan = _plan(planId);
        _requireOrganizer(plan);
        _requireStage(plan, Stage.Collection);
        if (plan.collectionRoomId != 0) {
            revert CollectionRoomAlreadyLinked(planId);
        }
        _requireUnlinkedRoom(collectionRoomId);

        IFairCircleCore.RoomView memory room = fairCircleCore.getRoom(collectionRoomId);
        if (room.mode != IFairCircleCore.RoomMode.PrivateCircle) {
            revert InvalidChildRoom(collectionRoomId);
        }
        _requireOrganizerMatch(plan.organizer, room.organizer);
        _requireMembersMatch(plan, collectionRoomId);

        IFairCircleCore.PrivateCircleView memory collection = fairCircleCore.getPrivateCircle(
            collectionRoomId
        );
        if (collection.confidentialToken != approvedConfidentialToken) {
            revert TokenMismatch(approvedConfidentialToken, collection.confidentialToken);
        }
        if (collection.recipient != plan.intendedRecipient) {
            revert RecipientMismatch(plan.intendedRecipient, collection.recipient);
        }
        if (collection.publicTarget != plan.selectedCost) {
            revert TargetMismatch(plan.selectedCost, collection.publicTarget);
        }
        if (collection.access != IFairCircleCore.CollectionAccess.InviteOnly) {
            revert CollectionAccessMismatch(collection.access);
        }

        plan.collectionRoomId = collectionRoomId;
        plan.updatedAt = uint64(block.timestamp);
        linkedPlanForRoom[collectionRoomId] = planId;

        emit PrivateCircleRoomLinked(
            planId,
            collectionRoomId,
            collection.recipient,
            collection.publicTarget,
            Stage.Collection
        );
    }

    function completePlan(uint256 planId) external {
        Plan storage plan = _plan(planId);
        _requireStage(plan, Stage.Collection);
        if (plan.collectionRoomId == 0) {
            revert CollectionRoomNotLinked(planId);
        }

        IFairCircleCore.PrivateCircleView memory collection = fairCircleCore.getPrivateCircle(
            plan.collectionRoomId
        );
        if (collection.collectionStatus != IFairCircleCore.CollectionStatus.Withdrawn) {
            revert CollectionNotWithdrawn(plan.collectionRoomId);
        }

        _setStage(plan, Stage.Complete);
        emit PlanCompleted(planId, plan.collectionRoomId, Stage.Complete);
    }

    function cancelPlan(uint256 planId) external {
        Plan storage plan = _plan(planId);
        _requireOrganizer(plan);
        if (plan.stage == Stage.Complete || plan.stage == Stage.Cancelled || plan.collectionRoomId != 0) {
            revert CancellationClosed(plan.stage);
        }

        _setStage(plan, Stage.Cancelled);
        emit PlanCancelled(planId, Stage.Cancelled);
    }

    function getPlan(uint256 planId) external view returns (PlanView memory) {
        Plan storage plan = _plan(planId);
        return _planView(planId, plan);
    }

    function getPlanMembers(uint256 planId) external view returns (address[] memory) {
        Plan storage plan = _plan(planId);
        return plan.members;
    }

    function getPlanOptions(uint256 planId) external view returns (uint256[] memory) {
        Plan storage plan = _plan(planId);
        return plan.options;
    }

    function getLinkedPlanForRoom(uint256 roomId) external view returns (uint256) {
        return linkedPlanForRoom[roomId];
    }

    function isPlanMember(uint256 planId, address account) external view returns (bool) {
        Plan storage plan = _plan(planId);
        return plan.isMember[account];
    }

    function canSelectOption(uint256 planId, uint256 optionIndex) external view returns (bool) {
        Plan storage plan = _plan(planId);
        if (plan.stage != Stage.Budget || optionIndex >= plan.options.length) {
            return false;
        }
        IFairCircleCore.RoomView memory budgetRoom = fairCircleCore.getRoom(plan.budgetRoomId);
        if (budgetRoom.status != IFairCircleCore.RoomStatus.Finalized) {
            return false;
        }
        (bool finalized, bool affordable) = fairCircleCore.getPublicAffordability(
            plan.budgetRoomId,
            optionIndex
        );
        return finalized && affordable && plan.options[optionIndex] != 0;
    }

    function canConfirmSplit(uint256 planId) external view returns (bool) {
        Plan storage plan = _plan(planId);
        if (plan.stage != Stage.Split || plan.splitRoomId == 0) {
            return false;
        }
        if (!fairCircleCore.sharesReady(plan.splitRoomId)) {
            return false;
        }
        if (plan.splitMethod == IFairCircleCore.SplitMethod.CapacityWeighted) {
            (bool finalized, bool feasible) = fairCircleCore.getPublicSplitFeasibility(
                plan.splitRoomId
            );
            return finalized && feasible;
        }
        return true;
    }

    function canCompletePlan(uint256 planId) external view returns (bool) {
        Plan storage plan = _plan(planId);
        if (plan.stage != Stage.Collection || plan.collectionRoomId == 0) {
            return false;
        }
        IFairCircleCore.PrivateCircleView memory collection = fairCircleCore.getPrivateCircle(
            plan.collectionRoomId
        );
        return collection.collectionStatus == IFairCircleCore.CollectionStatus.Withdrawn;
    }

    function _plan(uint256 planId) private view returns (Plan storage plan) {
        plan = plans[planId];
        if (!plan.exists) {
            revert InvalidPlanId(planId);
        }
    }

    function _planView(uint256 planId, Plan storage plan) private view returns (PlanView memory) {
        return
            PlanView({
                id: planId,
                title: plan.title,
                organizer: plan.organizer,
                stage: plan.stage,
                budgetRoomId: plan.budgetRoomId,
                selectedOptionIndex: plan.selectedOptionIndex,
                selectedCost: plan.selectedCost,
                splitMethod: plan.splitMethod,
                splitRoomId: plan.splitRoomId,
                collectionRoomId: plan.collectionRoomId,
                intendedRecipient: plan.intendedRecipient,
                createdAt: plan.createdAt,
                updatedAt: plan.updatedAt
            });
    }

    function _requireOrganizer(Plan storage plan) private view {
        if (msg.sender != plan.organizer) {
            revert NotOrganizer(msg.sender);
        }
    }

    function _requireStage(Plan storage plan, Stage expected) private view {
        if (plan.stage != expected) {
            revert WrongStage(expected, plan.stage);
        }
    }

    function _setStage(Plan storage plan, Stage stage) private {
        plan.stage = stage;
        plan.updatedAt = uint64(block.timestamp);
    }

    function _requireUnlinkedRoom(uint256 roomId) private view {
        uint256 linkedPlan = linkedPlanForRoom[roomId];
        if (linkedPlan != 0) {
            revert RoomAlreadyLinked(roomId, linkedPlan);
        }
    }

    function _requireOrganizerMatch(address expected, address actual) private pure {
        if (actual != expected) {
            revert OrganizerMismatch(expected, actual);
        }
    }

    function _requireMembersMatch(Plan storage plan, uint256 roomId) private view {
        address[] memory members = fairCircleCore.getMembers(roomId);
        if (members.length != plan.members.length) {
            revert MemberCountMismatch(plan.members.length, members.length);
        }
        for (uint256 i = 0; i < members.length; i += 1) {
            if (members[i] != plan.members[i]) {
                revert MemberMismatch(i, plan.members[i], members[i]);
            }
        }
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
}
