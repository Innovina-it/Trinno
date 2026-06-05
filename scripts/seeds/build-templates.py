#!/usr/bin/env python3
"""Build the per-project deliverable .docx templates from the ARISE template.

The deliverable docs the seeds attach to each card are copies of a Word template
that mirrors the ARISE skeleton (title, metadata table, Executive summary, Parts
I/II/III, sections, annexes). The only per-project difference is the HEADER: the
project name (H1 title + Project cell + page header), the subtitle, the lead
("Task lead"/footer) and the partners line. Everything else stays as the shared
template placeholders ([DOCUMENT TITLE], Document type, Work Package, …).

This script unzips the source .docx, string-replaces those values in
word/document.xml + word/header1.xml + word/footer1.xml (all contiguous in the XML
— no run-splitting), strips the "| [Document short name]" page-header placeholder,
and re-zips one .docx per project to scripts/seeds/templates/<key>.docx, which the
seeds upload (Drive API only, no Docs API) once per deliverable.

The "arise" output keeps ARISE's own identity (no header swap) — it only strips
the placeholder — so arise-drive.mjs can upload it instead of copying the raw
Drive template.

Run:  python3 scripts/seeds/build-templates.py
Source: scripts/seeds/templates/_arise-source.docx, else /tmp/arise.docx.
The source is "ARISE Template.docx" (Drive id 1oSPGtJMTHBBOpZRd8L02njO9mbJDn5KL),
downloaded once via the service account.
"""

import os
import re
import shutil
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "templates")
SRC = os.path.join(OUT, "_arise-source.docx")
if not os.path.exists(SRC):
    SRC = "/tmp/arise.docx"

# Values found verbatim in the ARISE template's XML (the things to swap out).
T_SUB = "Augmented Rehabilitation &amp; Intelligent System for Enhancement"
T_PARTNERS = "DINOGMI, University of Genoa, Studio Buccarella"
# "<name>   |   [Document short name]" page-header placeholder → keep just <name>.
PLACEHOLDER = re.compile(r"\s*\|\s*\[Document short name\]")
# Files in the .docx that carry header values / the placeholder.
FILES = ["word/document.xml", "word/header1.xml", "word/footer1.xml"]

# Per-project header. `name` = doc title/header/footer (boss-approved 2026-06-05):
# C&I and Swich both run "M.A.R.S. Firefighter" (C&I with a trailing period);
# Filse Spazio runs "M.A.R.S. Wildfire". "arise" has no `name` → no header swap,
# it keeps ARISE / Innovina / DINOGMI and only loses the placeholder.
PROJECTS = {
    "ci": {
        "name": "M.A.R.S. Firefighter.",
        "sub": "Collabora & Innova (Regione Lombardia FESR)",
        "partners": "Inspire S.r.l., Rafla S.r.l., Synesthesia S.r.l., Università di Pavia",
    },
    "swich": {
        "name": "M.A.R.S. Firefighter",
        "sub": "Swich",
        "partners": "Inspire S.r.l., BE-ST, POLITO, CNR, UNIGE",
    },
    "wildfire": {
        "name": "M.A.R.S. Wildfire",
        "sub": "Filse Spazio (FILSE Liguria · Space Economy)",
        "partners": "Inspire S.r.l. (consultants: Rafla, Invenio, CNR; research: UNIGE-DIME)",
    },
    "arise": {},  # keep ARISE identity; only strip the placeholder
}


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def main():
    if not os.path.exists(SRC):
        raise SystemExit(
            f"source docx not found ({SRC}); re-download the ARISE template first"
        )
    for key, v in PROJECTS.items():
        wd = f"/tmp/_tpl_{key}"
        if os.path.exists(wd):
            shutil.rmtree(wd)
        os.makedirs(wd)
        subprocess.run(["unzip", "-o", "-q", SRC, "-d", wd], check=True)
        for rel in FILES:
            p = os.path.join(wd, rel)
            if not os.path.exists(p):
                continue
            x = open(p, encoding="utf-8").read()
            x = PLACEHOLDER.sub("", x)                      # all projects
            if "name" in v:                                 # M.A.R.S. header swap
                x = x.replace(T_SUB, esc(v["sub"]))
                x = x.replace(T_PARTNERS, esc(v["partners"]))
                x = x.replace("Innovina", "Inspire")        # footer + Task-lead cell
                x = x.replace("ARISE", esc(v["name"]))      # H1 + Project cell + header
            open(p, "w", encoding="utf-8").write(x)
        out = os.path.join(OUT, key + ".docx")
        if os.path.exists(out):
            os.remove(out)
        subprocess.run(["bash", "-c", f"cd {wd} && zip -r -X -q {out} ."], check=True)
        ph = subprocess.run(
            ["bash", "-c",
             f"unzip -p {out} word/header1.xml | grep -c 'Document short name' || true"],
            capture_output=True, text=True,
        ).stdout.strip()
        name = v.get("name", "ARISE (unchanged)")
        print(f"built {os.path.relpath(out, HERE)}  name={name!r}  placeholder-left={ph}")


if __name__ == "__main__":
    main()
