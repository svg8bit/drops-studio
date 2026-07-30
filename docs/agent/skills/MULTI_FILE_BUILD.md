# Runtime skill: multi-file-build

- `id`: `multi-file-build`
- `version`: `3.0.0`
- `description`: Build one coherent feature across real Project V2 files.
- `activation_signals`: build, multi-file, new product, new route, component hierarchy.
- `required_capabilities`: `project-v2`.
- `allowed_roles`: Planner, Coder, Design Agent.
- `allowed_tools`: scoped files, declared dependency install, checks, preview, checkpoint.
- `required_context_queries`: project structure, package manifest, entrypoints.
- `instructions`: reconcile imports/dependencies and submit one atomic scoped change.
- `acceptance_checks`: valid Project V2 and runnable category-native feature.
- `forbidden_claims`: generated files are not working until release evidence passes.
