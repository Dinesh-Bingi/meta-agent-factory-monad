# OBSERVER // LIVE_MONAD_CLIENT

## STATUS: LIVE CONNECTED

This interface connects to the **Monad Testnet** via **Alchemy Public RPC**.
It is a read-only observer of an **Autonomous Meta-Agent** managing **Real Worker Processes**.

## BEHAVIOR

The system monitors the chain in silence using isolated Web Workers.

1.  **Meta-Agent**: Monitoring Process (Main Thread).
    -   *Spawns* `VolatilityHunter` on sustained high gas.
    -   *Broadcasts* lifecycle events to **Monad Registry**.
2.  **Sub-Agents**: Independent Worker Threads.
    -   `hunter_sigma`: Spawns on High Volatility.
    -   `crisis_daemon`: Spawns on System Failures.
    -   *Isolation*: These agents share no memory and run in parallel.

## OBSERVATION GUIDE

- **`CHAIN_SYNC` Events**: Evidence of on-chain Registry transactions.
- **`LIFECYCLE` Events**: Creation/Destruction of worker threads.
- **Determinism**: Every action is traceable to a specific block signal.

## RUN

Open `index.html` in any browser.
**Requirement**: Internet access (to reach Alchemy RPC).
