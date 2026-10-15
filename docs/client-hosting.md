# Hosting Openopoly for clients

For an initial client pilot, use one paid Render Node web service with a persistent disk, and a stable custom domain managed through Cloudflare. The same service serves the UI, API and Socket.IO connections. Render supports [WebSockets](https://render.com/docs/websocket); no backend rewrite is required.

The repository includes [render.yaml](../render.yaml): one `0.5c-512mb` instance, a 1 GB disk at `/var/data`, the existing health endpoint, and manual deployments. These are current [Blueprint fields](https://render.com/docs/blueprint-spec), not a capacity guarantee. Creating this service incurs hosting charges; this repository has not provisioned it.

1. Connect the GitHub repository in Render and review its Blueprint before creating the paid service. The [Node range](https://render.com/docs/node-version) `>=22.13.0 <23` allows maintenance updates within Node 22; local verification used v22.21.0.
2. Test the assigned HTTPS address, then add your domain in Render and create the required Cloudflare DNS records following [Render's custom-domain instructions](https://render.com/docs/custom-domains).
3. Set `PUBLIC_ORIGIN` to that final HTTPS origin. Keep it stable: browser-stored guest seats do not automatically transfer between origins.
4. Keep daily backups of `/var/data/rooms.json` and verify restoration in an isolated instance. Never commit saved games or guest credentials. Importing an existing store requires a planned maintenance window and must preserve its authorizations.

Keep **one application instance**. The JSON store has one writer; migrate to a shared database and coordinate Socket.IO room state before adding horizontal replicas. Load-test the intended number of rooms before promising client capacity.

[Persistent disks](https://render.com/docs/disks) retain games across restarts but disable zero-downtime deploys. Automatic deployments are off so releases can be scheduled between games; a deployment can briefly disconnect players. Docker/Caddy remains an alternative for a host you manage.

The existing [Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) is suitable for temporary demonstrations. It is not the stable client address or an always-on managed application host.
