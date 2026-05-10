# Contributing

## Development

```bash
npm test
npm run lint
```

## Design rules

- Keep exports deterministic and portable.
- Normalize tenant-local IDs to stable references.
- Never infer destructive schema/data operations from missing desired state.
- Add tests for all planner safety behavior.
- Keep secrets and environment-only values out of versioned project files.

## Commit scope examples

- `cli:` command behavior
- `plugin:` Saltcorn UI/routes
- `planner:` diff/apply planning
- `format:` project file format
- `docs:` documentation
