// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

interface IFairCircleCore {
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

    function getRoom(uint256 roomId) external view returns (RoomView memory);

    function getMembers(uint256 roomId) external view returns (address[] memory);

    function getOptions(uint256 roomId) external view returns (uint256[] memory);

    function getPublicAffordability(
        uint256 roomId,
        uint256 optionIndex
    ) external view returns (bool finalized, bool affordable);

    function getSplitMethod(uint256 roomId) external view returns (SplitMethod);

    function getSplitTotalCost(uint256 roomId) external view returns (uint256);

    function getPublicSplitFeasibility(
        uint256 roomId
    ) external view returns (bool finalized, bool feasible);

    function sharesReady(uint256 roomId) external view returns (bool);

    function getPrivateCircle(uint256 roomId) external view returns (PrivateCircleView memory);

    function getPublicTargetStatus(
        uint256 roomId
    ) external view returns (bool finalized, bool reached, uint64 version);
}
