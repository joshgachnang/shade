---
name: ip:generate
description: "IP Step 5: Generate Output — produce final implementation plan and task list"
disable-model-invocation: true
---

# IP Step 5: Generate Output

Produce the final implementation plan document and a structured task list, then save them.

## Instructions

1. **Generate the Implementation Plan** in the standard format:

   ```markdown
   # Implementation Plan: [Feature Name]

   *When an engineer is assigned to a project but before you begin coding, you should fill in the implementation plan and get feedback from the engineering team. Once you have finished or you make any changes, tag Josh with the @ symbol so he can review. Also tag anyone else that needs to be notified, has conflicting work, etc.*

   ## **Models**
   [Content from plan step]

   ## **APIs**
   [Content from plan step]

   ## **Notifications**
   [Content from plan step]

   ## **UI**
   [Content from plan step]

   ## Phases
   [Content from plan step]

   ## Feature Flags & Migrations
   [Content from plan step]

   ## Activity Log & User Updates
   [Content from plan step]

   ## **Not included/Future work**
   [Content from plan step]

   ## Acceptance Criteria
   [If criteria exist from the PRD or shaping, include them here. Otherwise, leave a placeholder noting to run `/ip:acceptance` to generate them.]
   ```

2. **Generate the Task List** as a structured section at the bottom of the document:

   ```markdown
   ---

   ## Task List (Bot Consumption)

   *Structured task breakdown for automated implementation. Each task should be independently implementable and testable.*

   ### Phase 1: [Phase Name]

   - [ ] **Task 1.1**: [Short title]
     - Description: [What to implement]
     - Files: [Expected files to create/modify]
     - Depends on: [Other task IDs, or "none"]
     - Acceptance: [How to verify it's done]

   - [ ] **Task 1.2**: [Short title]
     ...

   ### Phase 2: [Phase Name]
   ...
   ```

   Tasks should be:
   - Small enough to be a single PR or commit
   - Ordered by dependency (models first, then APIs, then UI)
   - Specific about which files to create/modify
   - Clear about acceptance criteria

3. **Ask the user for the feature name** to use in the filename (suggest one based on the PRD). The filename should be kebab-case.

4. **Save the implementation plan:**
   - Ensure `docs/implementationPlans/` directory exists (create if needed)
   - Save to `docs/implementationPlans/[feature-name].md`
   - Confirm the file was saved and show the path

5. **Save the task plan:**
   - Ensure `docs/tasks/` directory exists (create if needed)
   - Save to `docs/tasks/[feature-name].md
   - Confirm the file was saved and show the path

6. **Final summary:**

   ```
   ## Implementation Plan Complete

   **Saved to**: docs/implementationPlans/[feature-name].md

   ### Quick Stats
   - Models: [count] new/modified
   - API Endpoints: [count]
   - Screens: [count]
   - Phases: [count]
   - Tasks: [count] total

   ### Next Steps
   1. Share with the engineering team for review
   2. Tag @Josh and relevant stakeholders
   3. Once approved, tasks can be loaded for implementation
   ```

6. Ask: "Want to make any final changes, or is this ready to share?"

## Arguments

None
