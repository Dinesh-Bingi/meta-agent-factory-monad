// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title AgentRegistry
 * @dev Minimal registry for Autonomous Agents on Monad Testnet.
 *      Uses events for cheap storage/indexing.
 */
contract AgentRegistry {
    event AgentRegistered(address indexed meta, bytes32 indexed agentId, uint256 blockNumber);
    event AgentDeregistered(address indexed meta, bytes32 indexed agentId, uint256 blockNumber);

    function registerAgent(bytes32 agentId) external {
        emit AgentRegistered(msg.sender, agentId, block.number);
    }

    function deregisterAgent(bytes32 agentId) external {
        emit AgentDeregistered(msg.sender, agentId, block.number);
    }
}
