"""Write the slashless public site's HTML; the source page stays relocatable."""
import argparse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="Index path in the staging directory")
    output = parser.parse_args().output
    source = Path(__file__).resolve().parents[1] / "vowel-lab" / "index.html"
    if source == output.resolve():
        parser.error("Use a staging path, not the portable source index.")
    html = source.read_bytes()
    marker = b'<base href="./">'
    if html.count(marker) != 1:
        parser.error("Expected one portable asset base in the index.")
    output.write_bytes(html.replace(marker, b'<base href="/vowel-lab/">'))


if __name__ == "__main__":
    main()
