# Implementation Plan: Movie Scene Analyzer

**Status:** Pending Verification
**Priority:** High
**Effort:** Big batch (1-2 weeks)
**IP:** IP-004

Build a system that ingests a movie file, extracts frames via scene-change detection, analyzes each frame with a vision LLM via OpenRouter, tags objects/characters/text, tracks characters across scenes using face recognition + actor list comparison, and stores everything in a searchable MongoDB Atlas Search index.

## Models

### Movie
Top-level record for an ingested movie file.

```typescript
{
  title: string;               // Movie title
  filePath: string;            // Path to source video file
  duration: number;            // Duration in seconds
  fps: number;                 // Source framerate
  resolution: { width: number; height: number };
  frameCount: number;          // Total extracted frames
  processedFrameCount: number; // Frames with completed analysis
  status: "pending" | "extracting" | "analyzing" | "complete" | "error";
  errorMessage?: string;
  actors: string[];            // Known actor names for character matching
  extractionConfig: {
    mode: "scene-change" | "interval" | "every-frame";
    intervalSeconds?: number;  // For interval mode
    sceneThreshold?: number;   // FFmpeg scene detection threshold (0-1, default 0.3)
  };
  openRouterModel: string;     // e.g. "google/gemini-2.0-flash-001" or "openai/gpt-4o"
}
```

### Frame
Individual extracted frame from a movie.

```typescript
{
  movieId: ObjectId;           // ref: Movie
  frameNumber: number;         // Sequential index
  timestamp: number;           // Seconds into the movie
  imagePath: string;           // Local filesystem path to extracted image
  width: number;
  height: number;
  fileSizeBytes: number;
  status: "pending" | "analyzing" | "complete" | "error";
  errorMessage?: string;
}
```

### FrameAnalysis
AI vision analysis results for a single frame.

```typescript
{
  frameId: ObjectId;           // ref: Frame
  movieId: ObjectId;           // ref: Movie (denormalized for search)
  timestamp: number;           // Denormalized from Frame
  sceneDescription: string;    // Natural language scene description
  objects: [{
    label: string;             // e.g. "car", "phone", "gun"
    confidence: number;        // 0-1
  }];
  characters: [{
    name: string;              // Actor name if matched, else "Unknown Person 1"
    description: string;       // Physical description, clothing, action
    confidence: number;
  }];
  text: [{
    content: string;           // OCR'd text
    context: string;           // e.g. "sign", "screen", "subtitle", "newspaper"
  }];
  tags: string[];              // High-level tags: "action", "dialogue", "outdoor", "night"
  mood: string;                // e.g. "tense", "comedic", "romantic"
  rawResponse: string;         // Full LLM response for debugging
  modelUsed: string;           // OpenRouter model that produced this
  tokensUsed: number;          // For cost tracking
}
```

### Character
Tracked character across the movie (built up during analysis).

```typescript
{
  movieId: ObjectId;
  name: string;                // Actor/character name
  actorName?: string;          // If matched to known actor
  appearances: [{
    frameId: ObjectId;
    timestamp: number;
    description: string;       // What they're doing/wearing in this frame
  }];
  firstSeen: number;           // Timestamp
  lastSeen: number;            // Timestamp
  totalAppearances: number;
}
```

## APIs

### Standard CRUD (via modelRouter)

| Route | Permissions | Searchable Fields | Sort |
|-------|-------------|-------------------|------|
| `/movies` | IsAuthenticated | title, status | -created |
| `/frames` | IsAuthenticated | movieId, status, frameNumber | timestamp |
| `/frameAnalyses` | IsAuthenticated | movieId, frameId | timestamp |
| `/characters` | IsAuthenticated | movieId, name | name |

### Custom Endpoints

**POST `/movies/:id/process`** — Kick off the full pipeline (extract → analyze → index)
- Validates movie file exists
- Starts background processing job
- Returns immediately with `{ jobId, status: "extracting" }`

**POST `/movies/:id/cancel`** — Cancel in-progress processing

**GET `/movies/:id/progress`** — Get processing progress
- Returns `{ status, totalFrames, processedFrames, percentage, currentPhase }`

**GET `/movies/:id/timeline`** — Get frame analysis timeline
- Returns condensed timeline with scene changes, character appearances, key events
- Supports `?character=name` and `?object=label` filters

**GET `/search`** — Full-text search across all analysis data
- Query params: `q` (search text), `movieId` (optional filter), `type` (objects|characters|text|tags|all)
- Uses MongoDB Atlas Search index
- Returns matching frames with highlighted analysis snippets
- Supports faceted results (group by type)

**GET `/search/suggest`** — Autocomplete suggestions
- Returns matching tags, object labels, character names

## Notifications

None for MVP. Processing status is polled from the frontend.

## UI

### Screens

1. **Movie List Screen** (`/movies`)
   - List of uploaded movies with status badges
   - Upload button (file picker)
   - Processing progress bars for in-progress movies

2. **Movie Detail Screen** (`/movies/:id`)
   - Movie metadata (title, duration, resolution, frame count)
   - Processing controls (start/cancel)
   - Progress indicator during processing
   - Frame grid/timeline view (thumbnails at scene changes)
   - Character panel — list of identified characters with appearance count
   - Tab navigation: Frames | Characters | Search

3. **Frame Detail Modal/Screen** (`/movies/:id/frames/:frameId`)
   - Full-size frame image
   - Analysis overlay panel:
     - Scene description
     - Objects list with confidence
     - Characters identified
     - Text/OCR results
     - Tags and mood

4. **Search Screen** (`/search`)
   - Global search bar with type filters (objects, characters, text, tags)
   - Autocomplete suggestions
   - Results as frame thumbnails with matching context highlighted
   - Click through to Frame Detail
   - Filter by movie (when multiple movies exist)

### Navigation

```
Tab: Movies → Movie List → Movie Detail → Frame Detail
Tab: Search → Search Screen → Frame Detail
```

## Phases

### Phase 1: Models, APIs & Frame Extraction
- Create all 4 Mongoose models
- Register CRUD routes
- Implement FFmpeg frame extraction with scene-change detection
- Custom endpoint: `/movies/:id/process` (extraction only)
- Store frames to local filesystem

### Phase 2: OpenRouter Vision Analysis
- OpenRouter API client
- Vision prompt engineering (objects, characters, text, tags, mood)
- Batch processing with concurrency control
- Character tracking and actor name matching
- Frame analysis storage
- Progress tracking endpoint

### Phase 3: Search
- MongoDB Atlas Search index configuration
- Search endpoint with full-text + faceted search
- Autocomplete/suggest endpoint
- Character appearance timeline query

### Phase 4: Frontend — Movie Management
- Movie list screen with upload
- Movie detail screen with processing controls
- Progress indicators
- Regenerate SDK

### Phase 5: Frontend — Frame Viewer & Search
- Frame grid/timeline on movie detail
- Frame detail view with analysis overlay
- Search screen with filters and autocomplete
- Character panel

## Feature Flags & Migrations

- No feature flags needed (new feature, no existing users)
- MongoDB Atlas Search index must be created manually or via script on the Atlas cluster
- Frame images stored at `SHADE_DATA_DIR/movies/{movieId}/frames/`

## Activity Log & User Updates

Not needed for MVP — single-user tool.

## Not Included / Future Work

- Audio/dialogue transcription (could use existing Deepgram integration)
- Subtitle file parsing (SRT/VTT)
- Video clip extraction (extract short clips around interesting moments)
- Embedding-based semantic search (vector similarity)
- Face embedding storage for cross-movie character tracking
- Multiple movie comparison
- Export/report generation
- Cloud storage for frames
- WebSocket real-time progress (polling is fine for single-user)

---

## Task List

### Phase 1: Models, APIs & Frame Extraction

- [x] **Task 1.1**: Create Movie model and route
  - Description: Mongoose model with schema, types, and modelRouter CRUD route
  - Files: `backend/src/types/models/movie.ts`, `backend/src/models/movie.ts`, `backend/src/api/movie.ts`
  - Depends on: none
  - Acceptance: Can CRUD movies via API

- [x] **Task 1.2**: Create Frame model and route
  - Description: Mongoose model for extracted frames with movieId reference
  - Files: `backend/src/types/models/frame.ts`, `backend/src/models/frame.ts`, `backend/src/api/frame.ts`
  - Depends on: 1.1
  - Acceptance: Can CRUD frames via API

- [x] **Task 1.3**: Create FrameAnalysis model and route
  - Description: Mongoose model for vision analysis results
  - Files: `backend/src/types/models/frameAnalysis.ts`, `backend/src/models/frameAnalysis.ts`, `backend/src/api/frameAnalysis.ts`
  - Depends on: 1.2
  - Acceptance: Can CRUD frame analyses via API

- [x] **Task 1.4**: Create Character model and route
  - Description: Mongoose model for tracked characters across a movie
  - Files: `backend/src/types/models/character.ts`, `backend/src/models/character.ts`, `backend/src/api/character.ts`
  - Depends on: 1.1
  - Acceptance: Can CRUD characters via API

- [x] **Task 1.5**: FFmpeg frame extraction service
  - Description: Service that takes a movie file path, runs FFmpeg scene-change detection, extracts frames as JPEGs, creates Frame documents. Configurable threshold. Stores frames at `SHADE_DATA_DIR/movies/{movieId}/frames/`.
  - Files: `backend/src/services/frameExtractor.ts`
  - Depends on: 1.1, 1.2
  - Acceptance: Given a movie file, extracts frames at scene changes and creates Frame records

- [x] **Task 1.6**: Movie processing endpoint
  - Description: `POST /movies/:id/process` endpoint that validates the movie file exists and kicks off frame extraction. `GET /movies/:id/progress` for status polling.
  - Files: `backend/src/api/movie.ts`
  - Depends on: 1.5
  - Acceptance: POST triggers extraction, GET returns progress with frame count

### Phase 2: OpenRouter Vision Analysis

- [x] **Task 2.1**: OpenRouter API client
  - Description: Service to call OpenRouter vision API with an image. Handles auth, model selection, rate limiting, retries. Uses OpenAI-compatible API format.
  - Files: `backend/src/services/openRouter.ts`
  - Depends on: none
  - Acceptance: Can send an image to OpenRouter and get structured analysis back

- [x] **Task 2.2**: Vision analysis prompt
  - Description: Craft the system/user prompt for frame analysis. Should extract: scene description, objects with confidence, character descriptions, OCR text with context, tags, mood. Accept actor list for character matching. Return structured JSON.
  - Files: `backend/src/services/visionPrompt.ts`
  - Depends on: none
  - Acceptance: Prompt produces consistent structured JSON output with all required fields

- [x] **Task 2.3**: Frame analysis pipeline
  - Description: Service that processes all pending frames for a movie. Runs analysis with concurrency control (configurable, default 5 concurrent). Updates Frame and FrameAnalysis records. Updates movie progress. Handles errors per-frame without stopping the pipeline.
  - Files: `backend/src/services/frameAnalyzer.ts`
  - Depends on: 2.1, 2.2, 1.3
  - Acceptance: Processes all frames, creates FrameAnalysis records, updates progress

- [x] **Task 2.4**: Character tracking service
  - Description: After all frames are analyzed, consolidate character appearances. Match descriptions to actor names using the movie's actor list. Create/update Character documents with appearance timeline.
  - Files: `backend/src/services/characterTracker.ts`
  - Depends on: 2.3, 1.4
  - Acceptance: Characters are consolidated with correct actor name matching and appearance counts

- [x] **Task 2.5**: Full pipeline orchestration
  - Description: Wire extraction → analysis → character tracking into a single pipeline triggered by `/movies/:id/process`. Update movie status through each phase.
  - Files: `backend/src/services/moviePipeline.ts`, update `backend/src/api/movie.ts`
  - Depends on: 1.5, 2.3, 2.4
  - Acceptance: Single API call processes entire movie end-to-end

### Phase 3: Search

- [x] **Task 3.1**: MongoDB Atlas Search index definition
  - Description: Define Atlas Search index on FrameAnalysis collection covering: sceneDescription, objects.label, characters.name, characters.description, text.content, tags, mood. Create a script to set up the index.
  - Files: `backend/src/scripts/createSearchIndex.ts`
  - Depends on: 1.3
  - Acceptance: Atlas Search index is created and queryable

- [x] **Task 3.2**: Search endpoint
  - Description: `GET /search` endpoint using Atlas Search `$search` aggregation. Supports text query, movie filter, type filter (objects/characters/text/tags). Returns matching frames with analysis snippets and highlights.
  - Files: `backend/src/api/search.ts`
  - Depends on: 3.1
  - Acceptance: Can search across all analysis fields and get relevant frame results

- [x] **Task 3.3**: Autocomplete endpoint
  - Description: `GET /search/suggest` using Atlas Search autocomplete. Returns matching tags, object labels, character names as user types.
  - Files: `backend/src/api/search.ts`
  - Depends on: 3.1
  - Acceptance: Returns relevant suggestions as user types partial queries

- [x] **Task 3.4**: Timeline endpoint
  - Description: `GET /movies/:id/timeline` returns a condensed timeline of scene changes with key events, filterable by character or object.
  - Files: `backend/src/api/movie.ts`
  - Depends on: 2.3
  - Acceptance: Returns chronological timeline filterable by character/object

### Phase 4: Frontend — Movie Management

- [x] **Task 4.1**: Regenerate SDK
  - Description: Run `bun run sdk` in frontend to pick up new backend routes
  - Files: `frontend/store/openApiSdk.ts`
  - Depends on: Phase 1-3 complete
  - Acceptance: SDK has hooks for all new endpoints
  - Note: Hooks added manually to `sdk.ts` since backend wasn't running. Run `bun run sdk` when backend is live to sync `openApiSdk.ts`.

- [x] **Task 4.2**: Movie list screen
  - Description: Screen showing all movies with status badges, upload button (file picker for local files), processing progress bars. Uses `useListMoviesQuery`.
  - Files: `frontend/app/(tabs)/movies/index.tsx`
  - Depends on: 4.1
  - Acceptance: Can see movies, upload new ones, see processing status

- [x] **Task 4.3**: Movie detail screen
  - Description: Movie metadata, start/cancel processing buttons, progress bar, frame thumbnail grid, character panel. Tab nav for Frames/Characters sections.
  - Files: `frontend/app/(tabs)/movies/[id].tsx`
  - Depends on: 4.1
  - Acceptance: Can view movie details, trigger processing, see frames and characters

### Phase 5: Frontend — Frame Viewer & Search

- [x] **Task 5.1**: Frame detail view
  - Description: Full-size frame image with analysis overlay panel showing scene description, objects, characters, text, tags, mood.
  - Files: `frontend/app/(tabs)/movies/[id]/frames/[frameId].tsx`
  - Depends on: 4.3
  - Acceptance: Can view frame with all analysis data displayed

- [x] **Task 5.2**: Search screen
  - Description: Global search with type filter tabs (All/Objects/Characters/Text/Tags), autocomplete suggestions, results as frame thumbnails with highlighted matching context.
  - Files: `frontend/app/(tabs)/search.tsx`
  - Depends on: 4.1
  - Acceptance: Can search across movies, see results with context, click through to frame detail

- [x] **Task 5.3**: Add search tab to navigation
  - Description: Add Search tab to bottom tab navigator alongside existing tabs.
  - Files: `frontend/app/(tabs)/_layout.tsx`
  - Depends on: 5.2
  - Acceptance: Search tab visible and navigable

---

## Acceptance Criteria

### Required testIDs

```
# Movie List Screen
movies-screen                    # Root view
movies-list                      # FlatList container
movies-item-{id}                 # Individual movie row
movies-item-{id}-status          # Status badge
movies-item-{id}-progress        # Progress bar
movies-upload-button             # Upload/add movie button
movies-empty-state               # Empty state view
movies-loading-spinner           # Loading indicator

# Movie Detail Screen
movie-detail-screen              # Root view
movie-detail-title               # Movie title
movie-detail-status              # Status badge
movie-detail-duration            # Duration display
movie-detail-resolution          # Resolution display
movie-detail-frame-count         # Frame count display
movie-detail-process-button      # Start processing button
movie-detail-cancel-button       # Cancel processing button
movie-detail-progress-bar        # Processing progress bar
movie-detail-progress-text       # "X / Y frames" text
movie-detail-actors-input        # Actor names input
movie-detail-model-select        # OpenRouter model selector
movie-detail-tab-frames          # Frames tab
movie-detail-tab-characters      # Characters tab
movie-detail-frame-grid          # Frame thumbnail grid
movie-detail-frame-{id}          # Individual frame thumbnail
movie-detail-character-list      # Character list
movie-detail-character-{id}      # Individual character row
movie-detail-loading-spinner     # Loading indicator

# Frame Detail Screen
frame-detail-screen              # Root view
frame-detail-image               # Full-size frame image
frame-detail-timestamp           # Timestamp display
frame-detail-scene-description   # Scene description text
frame-detail-objects-list        # Objects section
frame-detail-object-{index}      # Individual object tag
frame-detail-characters-list     # Characters section
frame-detail-character-{index}   # Individual character entry
frame-detail-text-list           # OCR text section
frame-detail-text-{index}        # Individual text entry
frame-detail-tags-list           # Tags section
frame-detail-tag-{index}         # Individual tag
frame-detail-mood                # Mood display
frame-detail-loading-spinner     # Loading indicator

# Search Screen
search-screen                    # Root view
search-input                     # Search text input
search-filter-all                # "All" filter tab
search-filter-objects            # "Objects" filter tab
search-filter-characters         # "Characters" filter tab
search-filter-text               # "Text" filter tab
search-filter-tags               # "Tags" filter tab
search-suggestions-list          # Autocomplete dropdown
search-suggestion-{index}        # Individual suggestion
search-results-list              # Results container
search-result-{index}            # Individual result card
search-result-{index}-thumbnail  # Result frame thumbnail
search-result-{index}-context    # Result matching context
search-empty-state               # No results view
search-loading-spinner           # Loading indicator
```

---

# Test Cases: Movie Scene Analyzer

**Screen(s):** Movie List, Movie Detail, Frame Detail, Search
**Date:** 2026-04-11
**Author:** Claude
**Related Code:** `frontend/app/(tabs)/movies/`, `frontend/app/(tabs)/search.tsx`

## Prerequisites
- Logged in as a standard user
- Backend running with MongoDB Atlas connection
- FFmpeg installed on backend host
- OpenRouter API key configured in backend environment
- For search tests: at least one fully processed movie exists

---

## TC-001: User uploads a movie and sees it in the list

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** User is on the Movie List screen. No movies exist yet.

**Steps:**
1. Verify empty state is displayed
2. Tap the upload button (`movies-upload-button`)
3. Select a movie file from the file picker
4. Wait for the movie to appear in the list

**Expected Result:**
- After step 1: `movies-empty-state` is visible with guidance text
- After step 4: `movies-list` contains one item. `movies-item-{id}` shows the movie title. `movies-item-{id}-status` shows "pending"

---

## TC-002: User starts processing a movie

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** A movie with status "pending" exists. User is on Movie Detail screen.

**Steps:**
1. Enter actor names in the actors input field
2. Select an OpenRouter model from the dropdown
3. Tap the "Process" button (`movie-detail-process-button`)
4. Observe the progress bar

**Expected Result:**
- After step 3: Status changes to "extracting". `movie-detail-progress-bar` appears. `movie-detail-process-button` is replaced by `movie-detail-cancel-button`
- After step 4: `movie-detail-progress-text` updates as frames are processed (e.g., "12 / 150 frames")

---

## TC-003: User views a fully processed movie's frames

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** A fully processed movie exists. User navigates to its detail screen.

**Steps:**
1. Verify movie status shows "complete"
2. Tap the "Frames" tab (`movie-detail-tab-frames`)
3. Verify frame thumbnails are displayed in a grid
4. Tap on a frame thumbnail

**Expected Result:**
- After step 2: `movie-detail-frame-grid` is visible with multiple `movie-detail-frame-{id}` thumbnails
- After step 4: Navigates to Frame Detail screen (`frame-detail-screen` visible)

---

## TC-004: User views frame analysis details

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** User is on the Frame Detail screen for a processed frame.

**Steps:**
1. Verify the frame image is displayed
2. Check scene description is present
3. Check objects list is populated
4. Check characters list is populated
5. Check text/OCR section
6. Check tags are displayed
7. Check mood is displayed

**Expected Result:**
- `frame-detail-image` shows the frame
- `frame-detail-timestamp` shows time in movie (e.g., "01:23:45")
- `frame-detail-scene-description` contains non-empty text
- `frame-detail-objects-list` contains at least one `frame-detail-object-{index}` with a label
- `frame-detail-characters-list` contains at least one `frame-detail-character-{index}` with name and description
- `frame-detail-tags-list` contains at least one `frame-detail-tag-{index}`
- `frame-detail-mood` contains non-empty text

---

## TC-005: User views character appearances

**Priority:** P1
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** A fully processed movie exists with identified characters. User is on Movie Detail screen.

**Steps:**
1. Tap the "Characters" tab (`movie-detail-tab-characters`)
2. Verify character list is populated
3. Tap on a character entry

**Expected Result:**
- After step 1: `movie-detail-character-list` is visible
- After step 2: At least one `movie-detail-character-{id}` is visible showing character name and appearance count
- After step 3: Filters frame grid to show only frames where this character appears

---

## TC-006: User searches for objects across a movie

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** At least one fully processed movie. User is on the Search screen.

**Steps:**
1. Tap the search input (`search-input`)
2. Type "car"
3. Wait for autocomplete suggestions
4. Tap the "Objects" filter tab (`search-filter-objects`)
5. Press Enter or tap a suggestion to search
6. Verify results appear

**Expected Result:**
- After step 3: `search-suggestions-list` shows suggestions containing "car"
- After step 5: `search-results-list` shows matching frames
- Each `search-result-{index}` shows a thumbnail (`search-result-{index}-thumbnail`) and matching context (`search-result-{index}-context`) highlighting "car"

---

## TC-007: User searches for OCR text

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** Processed movie with frames containing visible text. User is on Search screen.

**Steps:**
1. Type a known text string in the search input
2. Tap the "Text" filter tab (`search-filter-text`)
3. Submit search

**Expected Result:**
- Results show frames where the searched text was detected via OCR
- `search-result-{index}-context` shows the OCR'd text with the query highlighted

---

## TC-008: User searches for a character by name

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** Processed movie with actor names configured. User is on Search screen.

**Steps:**
1. Type an actor name in the search input
2. Tap the "Characters" filter tab (`search-filter-characters`)
3. Submit search

**Expected Result:**
- Results show frames where the character/actor appears
- Context shows the character's description from the analysis

---

## TC-009: Search returns no results

**Priority:** P1
**Type:** Empty State
**Automation:** [automated]

**Precondition:** User is on Search screen.

**Steps:**
1. Type "xyznonexistent12345" in the search input
2. Submit search

**Expected Result:**
- `search-empty-state` is visible with "No results found" message
- `search-results-list` is not visible or empty

---

## TC-010: User cancels in-progress processing

**Priority:** P1
**Type:** Happy Path
**Automation:** [manual-only: requires long-running movie processing to be in progress]

**Precondition:** A movie is actively being processed (status "extracting" or "analyzing").

**Steps:**
1. Navigate to the movie's detail screen
2. Tap the cancel button (`movie-detail-cancel-button`)

**Expected Result:**
- Processing stops. Status changes to "error" or reverts to "pending"
- Already-extracted frames and completed analyses are preserved
- `movie-detail-process-button` reappears to allow re-processing

---

## TC-011: Movie list loading state

**Priority:** P1
**Type:** Loading State
**Automation:** [automated]

**Precondition:** User navigates to Movie List screen.

**Steps:**
1. Navigate to the movies screen
2. Observe loading state before data arrives

**Expected Result:**
- `movies-loading-spinner` is visible briefly
- After data loads, spinner disappears and either `movies-list` or `movies-empty-state` is shown

---

## TC-012: Frame detail loading state

**Priority:** P1
**Type:** Loading State
**Automation:** [automated]

**Precondition:** User taps a frame thumbnail.

**Steps:**
1. Tap a frame in the grid
2. Observe loading state

**Expected Result:**
- `frame-detail-loading-spinner` is visible while analysis data loads
- Once loaded, all analysis sections appear

---

## TC-013: Search with filter switching

**Priority:** P1
**Type:** Edge Case
**Automation:** [automated]

**Precondition:** User has search results displayed on Search screen.

**Steps:**
1. Search for a broad term (e.g., "person")
2. Note the result count with "All" filter active
3. Tap "Characters" filter
4. Verify results change to only character matches
5. Tap "All" filter
6. Verify original results return

**Expected Result:**
- Switching filters updates results in real-time without re-submitting the query
- Character filter shows only results where the match is in character data
- "All" shows combined results across all types

---

## TC-014: Search result navigates to correct frame

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** Search results are displayed.

**Steps:**
1. Note the timestamp/context of the first search result
2. Tap the result card (`search-result-0`)
3. Verify navigation to Frame Detail

**Expected Result:**
- `frame-detail-screen` is visible
- Frame image and analysis match the search result that was tapped
- `frame-detail-timestamp` matches the timestamp shown in the search result

---

## TC-015: Processing progress updates in movie list

**Priority:** P1
**Type:** Happy Path
**Automation:** [manual-only: requires active processing to observe real-time updates]

**Precondition:** A movie is being processed. User is on Movie List screen.

**Steps:**
1. Observe the movie's progress bar in the list
2. Wait for progress to update

**Expected Result:**
- `movies-item-{id}-progress` shows a progress bar that increases over time
- `movies-item-{id}-status` shows the current phase (extracting/analyzing)
