# TODO

## CLI output

- [ ] Make `apply` output compact by default.
  - Include success/error status, operation and warning summaries, backup receipt, and adapter result.
  - Omit the full resulting project state from the default response.
  - Add an explicit `--full-output` option for callers that need the complete state JSON.
