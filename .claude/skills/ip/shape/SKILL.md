---
name: ip:shape
description: "IP Step 3: Shape & Question — narrow the solution with models/APIs first, then everything else"
disable-model-invocation: true
---

# IP Step 3: Shape & Question

This is the core shaping step inspired by the Shape Up methodology. The goal is to narrow the solution from a raw idea to a well-defined approach with clear boundaries.

## Instructions

### Phase 1: Models & APIs (get alignment first)

This is the most important part. Models and APIs define the shape of the feature — everything else follows from them.

1. **Draft the data model** based on the PRD and research:
   - Mongoose schemas with types, required fields, enums, defaults
   - Relationships to existing models (refs)
   - Indexes if relevant
   - Plugins (soft delete, timestamps, etc.) based on existing patterns

2. **Draft the API surface**:
   - List each endpoint (method, path, description)
   - Note if it's a standard CRUD modelRouter or custom
   - Specify permissions for each endpoint
   - Call out any special query parameters, filters, or bulk operations

3. **Present both together** and ask the user: "Are these models and APIs the right approach?" Use AskUserQuestion.

4. **Iterate** until the user confirms the models and APIs are right. This is the foundation — don't move on until it's solid.

### Phase 2: Everything Else (flows from models/APIs)

Once models and APIs are confirmed, draft the remaining concerns in a single pass. These should follow naturally from the model/API decisions:

- **Notifications**: Push, email, in-app — who gets notified, when, what content. If none needed, say so.
- **Activity Log**: What actions get logged, which surface as User Updates, which user groups see them. If none, say so.
- **Permissions & Access**: Role-based differences beyond what's already covered in API permissions.
- **UI**: New screens/components, navigation flow, key interactions and states, reusable vs new components.
- **Feature Flags & Migration**: Whether a flag is needed, any data migrations, rollout strategy.
- **Phases**: How to break the work into PRs (Phase 1: models + APIs, Phase 2: core UI, Phase 3: polish). If small enough, say "single phase."
- **Not Included / Future Work**: Compile out-of-scope items and deferred ideas.

Present all of this as a single shaped solution summary:

```
## Shaped Solution

### Core Concept
[1-2 sentence description of the approach]

### Models
[schemas from Phase 1]

### APIs
[endpoints from Phase 1]

### Notifications
[notification plan or "none needed"]

### Activity Log
[logging plan or "none needed"]

### UI
[screens, flows, interactions]

### Phases
[implementation phases]

### Not Included
[explicitly excluded items]

### Risks & Mitigations
- [risk]: [mitigation approach]
```

Surface any **risks and rabbit holes** inline:
- Technical risks: things that might be harder than they look
- Scope risks: features that could balloon if not bounded
- For each risk, suggest a mitigation or simpler fallback

Ask: "Does this shaped solution look right? Any decisions you want to revisit?"

Once confirmed, say: **"Solution shaped. Moving to output generation..."** and proceed to run `/ip:generate`.

## Arguments

None
