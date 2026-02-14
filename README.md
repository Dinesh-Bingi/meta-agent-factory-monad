Meta-Agent Factory

Autonomous On-Chain Agent Governance on Monad

Meta-Agent Factory is an autonomous lifecycle governance system built on the Monad network. Instead of deploying static agents, a central Meta-Agent continuously monitors live blockchain conditions and deterministically decides when specialized Sub-Agents should be created or terminated.

All lifecycle events are immutably recorded on-chain through a minimal registry contract, ensuring verifiable and irreversible agent management. The user interface functions strictly as a read-only observer of confirmed chain state, demonstrating genuine autonomy rather than simulated behavior.

Key Features

Deterministic agent lifecycle governance

Isolated Sub-Agent execution via Web Workers

Real-time Monad block monitoring

Signed on-chain lifecycle transactions

Immutable lifecycle anchoring through smart contracts

Monad Integration

The system integrates directly with Monad via authenticated JSON-RPC connections for live block polling and transaction execution. Lifecycle transitions are written to a deployed registry contract on Monad Testnet, making every agent creation and termination externally verifiable.

Setup

Clone the repository

Copy .env.example to .env

Add your MONAD_RPC_URL and META_AGENT_PRIVATE_KEY

Install dependencies with npm install

Run with npm start

All Rights Reserved to Team VD
