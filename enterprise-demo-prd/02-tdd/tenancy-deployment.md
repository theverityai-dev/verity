# Tenancy & Deployment

### Shared SaaS
Many tenants in one deployment; tenant-owned data is RLS protected.

### Dedicated
One tenant in one deployment; tenant_id/RLS still remain active.

### On-prem
Client-controlled deployment using the same application security model. Provider interfaces allow auth/storage/secrets/observability to be supplied by client infrastructure when required.
