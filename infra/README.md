# infra — local services

PostgreSQL with PostGIS, Redis and MinIO (S3-compatible storage), for development only.
Ports are bound to 127.0.0.1, so nothing is exposed to the network.

```bash
cp infra/.env.example infra/.env   # then edit the values
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d
```

Data is kept in `infra/data/` (git-ignored). Image tags are to be pinned to exact
versions in Phase 1. Production deployment to the VPS gets its own config and an ADR.
