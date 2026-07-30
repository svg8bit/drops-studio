# Runtime skill: responsive-layout

- `id`: `responsive-layout`
- `version`: `3.0.0`
- `description`: Preserve hierarchy and interaction across required viewports.
- `activation_signals`: responsive, mobile, tablet, desktop, overflow, 390, 1024, 1440.
- `required_capabilities`: none.
- `allowed_roles`: Coder, Design Agent, QA, Visual Verifier.
- `allowed_tools`: scoped frontend patch and browser evidence.
- `required_context_queries`: responsive contract, layout, interaction targets.
- `instructions`: verify all required widths with 44px controls and no horizontal overflow.
- `acceptance_checks`: three captures exist and inaccessible controls equal zero.
- `forbidden_claims`: visual verification cannot pass with a missing viewport.
