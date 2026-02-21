# Common Patterns

## Documentation Pattern

Every major implementation must follow:

1. PLAN – Research before coding
2. WORK – Implement according to plan
3. ASSESS – Self-review and test
4. COMPOUND – Document lessons learned

---

## Git Commit Pattern

- Small commits
- Descriptive commit messages
- One logical change per commit
- No massive “fix everything” commits

---

## Architecture Pattern

- Clear separation of concerns:
  - ingestion layer
  - processing layer
  - storage layer
  - analysis layer
  - UI layer

- No business logic inside UI components.
- Database queries abstracted into services.

---

## AI Integration Pattern (Planned)

- Always cache AI responses
- Never call AI inside loops
- Separate:
  - prompt builder
  - AI execution
  - result parsing
