# Slow Life Collective hosted worker

Manual, read-only GitHub Actions check of the official Higgsfield CLI using subscription credits. No generation, scheduling or Instagram publishing is enabled by this repository.

The Netlify studio handles the calendar and final human approval. Target rhythm: four posts weekly, two six-image carousels and two five-second Reels.

`HIGGSFIELD_SESSION` is an encrypted Actions secret, never a repository file. Runs omit account identity and balance from logs. Workflows run only manually and have a five-minute timeout. Credential renewal across ephemeral runners is not yet established; this is a connection check, not the finished generation worker.

Remaining: secure studio job queue, atomic credit reservations, generation/result handling, durable media storage, session renewal and owner-visible failures. Publishing stays paused until an end-to-end check and final post approval.
