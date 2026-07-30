# Runtime skill: sandbox-debugging

- `id`: `sandbox-debugging`
- `version`: `3.0.0`
- `description`: Debug verified failures inside the canonical Vercel Sandbox.
- `activation_signals`: debug, repair, type error, build error, runtime error, logs.
- `required_capabilities`: `vercel-sandbox`.
- `allowed_roles`: Coder, AutoFix, QA.
- `allowed_tools`: read/log, scoped patch, checks, preview.
- `required_context_queries`: failing diagnostic, affected symbol, current run.
- `instructions`: use bounded real evidence and stop when the failure class changes.
- `acceptance_checks`: original diagnostic gone and no new blocker introduced.
- `forbidden_claims`: a patch is not verified until the failed check reruns.
