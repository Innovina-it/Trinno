# Harvest — instant-feedback

## 2026-06-12 — punto 2 dei foundational systems, accettato a Gate 4

**What happened:** recon (subagent Explore) ribaltò il brief: dei "campi lenti del modal" ne restavano 2 su 25+; il vero problema era il lampeggio da router.refresh() (25+ siti, peggiore: bulk bar). Scope tagliato di conseguenza: helper `optimisticWrite` + 2 migrazioni + de-blink della bulk bar. 23 siti già sani NON migrati (adozione on-touch).

**Lessons:**
1. **Brief di prodotto invecchiano in settimane:** il documento descriveva un'app di 2+ mesi fa. Il recon-prima-dello-spec ha evitato di costruire una pipeline per un problema già risolto.
2. **base-ui ignora `onSelect` in silenzio.** Quattro item di menu (type picker, Clear priority, Move/Archive del modal) erano MORTI dalla migrazione Radix→base-ui — nessun errore, nessun warning, click senza effetto. Scoperto solo perché un test e2e cliccava e asseriva. Tripwire candidato: grep CI `onSelect=` su DropdownMenuItem (deve restare a zero).
3. **L'ottimismo cambia i timing dei test:** con la UI che scatta prima della rete, i test devono aspettare il *segnale di persistenza* (banner = push avvenuto) prima di chiedere l'undo — il flip visivo non basta più.
4. **Il refresh "cintura e bretelle" è il blink:** 6 bulk op su 8 avevano già patch locali complete + CDC; il refresh in coda era solo danno visivo.

**Deferred (decisione separata):** superfici settings/admin ancora refresh-based (workspace settings, ruoli membri, dashboards, sprint) — tollerabili, fase 2 se richiesta.
