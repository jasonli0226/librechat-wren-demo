import sys
from pathlib import Path

# chart_tool lives next to serve_mcp.py, which runs as a script from wren/scripts.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
