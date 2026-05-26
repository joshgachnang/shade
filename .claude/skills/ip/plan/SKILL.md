---
name: ip:plan
description: "IP Step 4: Plan Sections — walk through each section of the implementation plan interactively"
disable-model-invocation: true
---

# IP Step 4: Plan Sections

Walk through each section of the implementation plan interactively. For each section, propose content based on the shaped solution, then let the user refine it.

## Instructions

Work through each section below one at a time. For each section:
- Present a draft based on the PRD, research, and shaping decisions
- Ask the user if the draft looks right or needs changes
- Let them edit inline or provide feedback
- Finalize before moving to the next section

### Section 1: Models

1. Draft Mongoose schemas based on the shaped solution. Include:
   - Full schema code blocks with types, required fields, enums, defaults
   - Relationships to existing models (refs)
   - Indexes if relevant
   - Plugins (soft delete, timestamps, etc.) based on existing patterns found in research

2. Present the schemas and ask:
   - "Do these models look right?"
   - "Any fields missing or that should be changed?"
   - "Should any of these fields be optional vs required?"

### Section 2: APIs

1. Draft the API surface:
   - List each endpoint (method, path, description)
   - Note if it's a standard CRUD modelRouter or custom
   - Specify permissions for each endpoint
   - Call out any special query parameters, filters, or bulk operations
   - Note any webhook or external API integrations

2. Present and ask: "Any endpoints missing? Do the permissions look right?"

### Section 3: Notifications

1. Based on the shaped solution, list:
   - Push notifications (who, when, what content)
   - Email/text notifications
   - In-app notifications or alerts
   - If none needed, explicitly state "No notifications required for this feature"

2. Present and confirm with user.

### Section 4: UI

1. Draft the UI plan:
   - List new screens/components
   - Describe navigation flow (how users get there)
   - Describe key interactions and states
   - Note any reusable components that already exist vs need to be created
   - Suggest fat-marker sketches if the UI is complex (describe what should be sketched)

2. Present and ask: "Does this UI approach make sense? Any screens or interactions missing?"

### Section 5: Phases

1. Propose how to break the work into phases/PRs:
   - Phase 1: Usually models + basic APIs
   - Phase 2: Core UI and integrations
   - Phase 3: Polish, notifications, edge cases
   - If the feature is small enough, note "Single phase - no need to break up"

2. For each phase, list what's included and what the deliverable looks like.

3. Present and ask: "Does this phasing make sense? Want to adjust?"

### Section 6: Feature Flags & Migrations

1. Based on the shaped solution, recommend:
   - Whether a feature flag is needed (and what it controls)
   - Any data migrations required
   - Rollout strategy

2. Present and confirm.

### Section 7: Activity Log & User Updates

1. List:
   - What actions get logged to the activity log
   - Which of those surface as User Updates
   - Which user groups see the updates

2. If no activity logging is needed, say so explicitly.

### Section 8: Not Included / Future Work

1. Compile the "out of scope" items from shaping into this section
2. Add any ideas that came up during planning but were deferred
3. Present and confirm.

After all sections are finalized, say: **"All sections planned. Moving to output generation..."** and proceed to run `/ip:generate`.

## Arguments

None
