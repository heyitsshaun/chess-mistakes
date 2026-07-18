# Comparison Mode: Custom Opening Line Analysis

> **SUPERSEDED (July 2026).** This feature was removed and replaced by
> **Repertoire mode** — see `REPERTOIRE_MODE.md`. Repertoire mode compares
> whole games against full course trees (not single lines), splits results
> into "I deviated first" vs "opponent deviated first", and drives the drill
> system. This document is kept for historical reference only.

## Overview
Comparison mode lets you load your prepared opening lines and automatically track how your actual games compare to those lines. During analysis, the system flags positions where you deviate from your repertoire and shows you statistics on your consistency.

## Features Implemented

### 1. Line Import
- Paste opening lines in **PGN or algebraic notation** (e.g., `1.e4 c5 2.Nf3 d6...`)
- Automatic **move validation** and **position calculation**
- Optional line naming (auto-detected from PGN headers)
- **Storage** in browser IndexedDB (persists across sessions)

### 2. Comparison During Analysis
- Each move you play is **automatically compared** to loaded lines
- **Real-time feedback** shows:
  - ✓ "Matches prepared line" (green badge)
  - "Deviates from line (expected Nf3)" (orange badge)
- **Deviation tracking** — all mismatches recorded with details
- Works in both **normal analysis** and **drill mode**

### 3. Deviation Statistics
- **Match rate**: % of moves that match the prepared line
- **Deviation count**: How many positions you diverged
- **Deviation positions**: Which positions you deviate from most often
- **First deviation**: Move number where you first left the line

### 4. Line Management
- **Load multiple lines** into comparison mode
- **Switch active line** to compare against
- **Remove lines** you no longer need
- **View all loaded lines** and their stats in settings

### 5. Data Persistence
- Comparison lines **included in exports/imports**
- Backed up with your analysis results
- **Restore** when importing backup files

## How to Use

### Adding a Line
1. Open Settings (⚙ icon)
2. Scroll to **"Comparison mode: study custom openings"**
3. Click **"Add comparison line"**
4. Paste your line (PGN or moves: `1.e4 c5 2.Nf3 d6...`)
5. Optionally name it (e.g., "Najdorf 6.Bg5")
6. Click **"Add line"**

### During Game Analysis
- Play through your games normally
- The system automatically checks each move against your line
- Look for the **comparison badges** after each move:
  - Green (✓) = You played the prepared move
  - Orange (⚠) = You deviated; best move was X
- Stats panel shows your total match rate

### Reviewing Deviations
1. Click **"Show deviations"** in the comparison panel
2. See a table of all positions where you diverged
3. Expected vs. played moves listed
4. Click to jump to specific deviation positions

### Switching Between Lines
- List shows all loaded lines
- Click a line to make it active
- Deviations are tracked per line
- Remove lines with the ✕ button

## Data Structure

### ComparisonLine
```javascript
{
  id: "line-1234567890",
  name: "Sicilian Najdorf 6.Bg5",
  moves: ["e4", "c5", "Nf3", "d6", ...],      // algebraic
  uciMoves: ["e2e4", "c7c5", "g1f3", ...],   // UCI format
  positions: [...]  // position data for matching
  createdAt: timestamp,
  lastUsed: timestamp
}
```

### Comparison Session
Tracks deviations for active line:
```javascript
{
  activeLineId: "line-123",
  deviations: [...],  // array of mismatches
  stats: {
    matchedMoves: 38,
    deviationMoves: 4,
    matchRate: "90.5%",
    ...
  }
}
```

## Technical Details

### How Matching Works
1. You play a move during analysis
2. System extracts **move UCI** (e.g., "e2e4")
3. Compares against **current position in active line**
4. If exact match:
   - ✓ Badge shown
   - Session advances to next move
5. If different:
   - Deviation recorded
   - Details saved (expected move, position, etc.)
   - Session doesn't advance (line abandoned)

### Storage
- Lines stored in browser's **IndexedDB** (`sessions/comparisonLines`)
- Survives page reload
- Included in backup exports
- Can import from backup file

### Comparison Algorithm
- Exact **UCI move matching** (e.g., "e2e4")
- Uses **position keys** for accurate position identification
- Handles **transpositions** via posKey
- **Non-invasive**: doesn't affect engine analysis or grading

## Use Cases

1. **Studying Prepared Openings**
   - Load your main lines
   - See which ones you consistently play
   - Find positions where you deviate
   - Drill the deviations to improve consistency

2. **Tracking Repertoire**
   - Add 5-10 lines you play regularly
   - Monitor which lines you stick to
   - Identify where you go wrong

3. **Opening Preparation**
   - Load opponent's main lines
   - See how you'd handle them
   - Compare your play to prepared lines
   - Use deviations as drill positions

4. **Comparing to Engine**
   - Separate from engine grading (uses both)
   - Engine says "good move" but line says "no"
   - Both pieces of feedback shown
   - Make informed decisions about your prep

## Edge Cases Handled

✓ **Line with < 10 moves** — still tracked, no blocks after line ends  
✓ **Multiple lines loaded** — can switch between them  
✓ **Transposed positions** — handled via position key  
✓ **Export/Import** — lines persist in backups  
✓ **Deviations in drill** — stats accumulate during drill practice  

## Current Limitations

- One **active line at a time** (others stay loaded but inactive)
- **Exact move matching** only (transposition to same opening not tracked as match)
- **Session-based** (deviations cleared when resetting)
- No visual board overlay yet (future)
- No heatmap/position analytics yet (future)

## Future Enhancements

Planned for future versions:
- **Multiple active lines** — compare against 2-3 simultaneously
- **Board overlay** — highlight expected moves with arrows
- **Position heatmap** — see which squares you deviate from most often
- **Repertoire stats** — win rate when following vs. deviating
- **Suggested lines** — AI recommends lines based on your play
- **Opponent prep** — load opponent's likely moves to compare

## Integration with Other Features

**Custom Ignored Lines** — Separate system  
- Custom book = moves you want to *ignore* from flagging
- Comparison lines = moves you want to *study*

**Drill Mode** — Full support  
- Drill positions show comparison feedback
- Deviations tracked during drills
- Match rate accumulated

**Engine Analysis** — Complementary  
- Engine grades move quality
- Comparison shows if it matches your prep
- Both pieces of feedback shown together

**Export/Import** — Full integration  
- Comparison lines included in backups
- Restored when importing

## Storage Size

Each line typically uses ~2-5 KB:
- 10 lines = ~20-50 KB
- 50 lines = ~100-250 KB
- Well under browser storage limits (IndexedDB: 50+ MB)

## Files Modified

- **core.js** — Added 9 comparison functions (comparison mode logic)
- **app.js** — Added UI rendering and event handling
- **index.html** — Added settings panel for comparison mode
- **styles.css** — Added styling for comparison UI (~60 lines)

## Testing the Feature

Try this to test:
1. Add line: `1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3`
2. Play the moves exactly
3. See "✓ Matches prepared line" badges
4. Deviate at move 5 (e.g., play Bf4)
5. See "Deviates from line" badge
6. Check stats: should show 9 matched, 1 deviation

That's it! Comparison mode is ready to use.
