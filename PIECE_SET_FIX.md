# Piece Set Selection Bug Fix

## Summary
Fixed two critical bugs that prevented piece set changes from being saved and applied correctly.

## The Problem
When users changed the piece set from Settings, the board would not update—pieces remained as the original set. Additionally, the dropdown selection could become out of sync with the actual piece set being displayed.

## Root Causes

### Bug 1: Wrong Value Saved to localStorage (pieces.js line 44)
**Before:**
```javascript
try { localStorage.setItem(PREF_KEY, id); } catch (e) { /* optional */ }
```

**Problem:** The code was saving the *requested* piece set ID to localStorage, not the *actual* active piece set ID. This created a mismatch when:
- User selects "cburnett" but offline (fetch fails)
- `activate()` sets `active.id = "classic"` (fallback)
- But localStorage gets "cburnett" (the requested id)
- Result: localStorage says "cburnett" but Pieces.id() returns "classic"

**After:**
```javascript
try { localStorage.setItem(PREF_KEY, active.id); } catch (e) { /* optional */ }
```

Now localStorage always contains the actual piece set that's in use.

### Bug 2: Workaround Logic Masking the Real Problem (app.js line 1996)
**Before:**
```javascript
if (sel) sel.value = Pieces.id() === "classic" ? (localStorage.getItem("cmt-piece-set") || "classic") : Pieces.id();
```

**Problem:** This convoluted logic was a band-aid attempting to work around Bug 1. When the piece set fell back to "classic", it would try to show what the user *wanted* (from localStorage) even though the actual pieces were "classic". This created a misleading UI state.

**After:**
```javascript
if (sel) sel.value = Pieces.id();
```

Simple and correct: always show what Pieces.id() actually is.

## The Flow Now Works Correctly

### Scenario 1: User Selects "cburnett" (Online)
1. `Pieces.activate("cburnett")` called
2. Pieces fetched successfully, `active = { id: "cburnett", urls: {...} }`
3. localStorage set to "cburnett"
4. `onChange` callback triggers, sets dropdown value to "cburnett"
5. Board re-renders with cburnett pieces ✓

### Scenario 2: User Selects "cburnett" (Offline)
1. `Pieces.activate("cburnett")` called
2. Fetch fails, `active = { id: "classic", urls: null }`
3. localStorage set to "classic" (not "cburnett"!)
4. `onChange` callback triggers, sets dropdown value to "classic"
5. Board re-renders with classic pieces ✓
6. No mismatch between dropdown and actual rendering ✓

### Scenario 3: User Selects "classic"
1. `Pieces.activate("classic")` called
2. `active = { id: "classic", urls: null }`
3. localStorage set to "classic"
4. `onChange` callback triggers, sets dropdown value to "classic"
5. Board re-renders with classic pieces ✓

## Testing
All existing tests pass:
- 56 core logic tests ✓
- 15 UI smoke tests ✓

Created `test_piece_set.js` to specifically verify:
- Piece set selection is saved to localStorage
- Piece set is loaded correctly on page load
- localStorage and actual piece set stay in sync
- Fallback behavior works correctly when fetches fail

## Files Modified
- `pieces.js` - Line 44: Changed localStorage.setItem to use `active.id`
- `app.js` - Line 1996: Simplified onChange callback dropdown update logic
