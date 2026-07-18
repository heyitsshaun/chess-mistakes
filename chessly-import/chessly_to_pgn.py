#!/usr/bin/env python3
"""Convert a Chessly course crawl (raw JSON from chessly-crawler.js) into a PGN
with nested variations.

Usage: python3 chessly_to_pgn.py <raw.json> [out.pgn]

Leaf nodes get a PGN comment listing the Chessly studies that contain that
position, so lines can be traced back to their study/chapter.
"""
import json
import re
import sys
from datetime import date

import chess
import chess.pgn


def load(path):
    with open(path) as f:
        return json.load(f)


def chessly_fen(board):
    # Chessly stores FENs with the ep square always set after a double push
    return board.fen(en_passant="fen")


def build_game(data):
    positions = data["positions"]
    studies = data.get("studies", {})
    start_fen = data["startFen"]

    game = chess.pgn.Game()
    name = data.get("course", {}).get("name", "Chessly course")
    game.headers["Event"] = name
    game.headers["Site"] = data.get("course", {}).get("url", "https://chessly.com")
    game.headers["Date"] = date.today().strftime("%Y.%m.%d")
    game.headers["White"] = name
    game.headers["Black"] = "?"
    game.headers["Result"] = "*"
    if start_fen != chess.STARTING_FEN:
        game.headers["FEN"] = start_fen
        game.setup(chess.Board(start_fen))

    stats = {"leaves": 0, "nodes": 0, "max_depth": 0, "missing": 0}

    chapters = {c["id"]: c["name"] for c in data.get("chapters", [])}

    def study_label(sid):
        st = studies.get(sid, {})
        name = st.get("name", sid)
        ch = chapters.get(st.get("chapterId"))
        return f"{ch} / {name}" if ch else name

    def study_comment(fen):
        entry = positions.get(fen)
        if not entry:
            return None
        names = [study_label(sid) for sid in entry.get("s", [])]
        return "; ".join(names) if names else None

    def expand(node, board, path, depth):
        stats["nodes"] += 1
        stats["max_depth"] = max(stats["max_depth"], depth)
        fen = chessly_fen(board)
        entry = positions.get(fen)
        moves = entry["m"] if entry else []
        if entry is None:
            stats["missing"] += 1
        if not moves or fen in path:  # leaf or transposition cycle
            stats["leaves"] += 1
            c = study_comment(fen)
            if c and node.parent is not None:
                node.comment = (node.comment + " " if node.comment else "") + c
            return
        path = path | {fen}
        for san in moves:
            move = board.parse_san(san)
            child = node.add_variation(move)
            board.push(move)
            expand(child, board, path, depth + 1)
            board.pop()

    expand(game, chess.Board(start_fen), frozenset(), 0)
    return game, stats


def main():
    raw_path = sys.argv[1]
    data = load(raw_path)
    if len(sys.argv) > 2:
        out_path = sys.argv[2]
    else:
        slug = re.sub(r"[^a-z0-9]+", "-", data["course"]["name"].lower()).strip("-")
        out_path = f"chessly-{slug}.pgn"

    game, stats = build_game(data)
    with open(out_path, "w") as f:
        exporter = chess.pgn.FileExporter(f)
        game.accept(exporter)
        f.write("\n")
    print(f"Wrote {out_path}")
    print(f"  positions in crawl: {len(data['positions'])}")
    print(f"  tree nodes: {stats['nodes']}, lines (leaves): {stats['leaves']}, "
          f"max depth: {stats['max_depth']} plies, missing positions: {stats['missing']}")


if __name__ == "__main__":
    main()
