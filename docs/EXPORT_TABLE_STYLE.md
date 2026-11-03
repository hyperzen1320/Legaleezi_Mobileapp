# Case report exports — plain rows, tinted header

The chambers want the exported case report to read like a plain register:
**every row on a white background**, with only the **column-heading row**
tinted so it stands apart. Today the body rows alternate (zebra striping),
and on a printed page the shaded rows are what draws the eye.

This is a server change: the app only downloads the file. The exports are
generated in the web app (`legaleasy`) under `src/lib/case-export/`. The
snippets below were written without that source to hand, so variable names
are illustrative. Before editing, follow `legaleasy/AGENTS.md`.

## The look

| Part | Fill | Text | Rule |
| --- | --- | --- | --- |
| Column-heading row | `#EFE5D0` (light parchment, the app's own chip colour) | `#0A1124`, bold | `#C5853A` copper, 1 pt, under the row |
| Every data row | none (white) | `#0A1124` | `#E3D9C0`, 0.5 pt, between rows |

Leave everything else exactly as it is: the ink header band with the
emblem and office details, the copper "CASE REPORT · date" banner, the
filter line ("Hearing track — Tomorrow"), column widths, wrapping, and the
"Page X of Y" footer.

Do this in **all three formats** so the PDF, Word and Excel files still
look like one product. Whatever generates the Hearing Track export
(`/api/app/hearings/export`) should get the same treatment. If it reuses
these generators, there's nothing extra to do.

## Where

**PDF: `src/lib/case-export/pdf.ts` (pdfkit).** In the row loop, remove
the alternate-row fill (something like `if (i % 2) doc.rect(…).fill(ZEBRA)`).
Draw the heading row's background, then a copper rule under it:

```ts
doc.rect(x, y, tableWidth, headerHeight).fill("#EFE5D0");
// …heading text in #0A1124, bold…
doc.moveTo(x, y + headerHeight).lineTo(x + tableWidth, y + headerHeight)
   .lineWidth(1).strokeColor("#C5853A").stroke();
```

The heading row repeats on every page, so make the same change wherever
it's redrawn after a page break.

**Excel: `src/lib/case-export/xlsx.ts` (exceljs).** Drop the fill on
alternate rows. Give the heading row:

```ts
cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFE5D0" } };
cell.font = { ...cell.font, bold: true, color: { argb: "FF0A1124" } };
cell.border = { ...cell.border, bottom: { style: "thin", color: { argb: "FFC5853A" } } };
```

The frozen heading row stays frozen.

**Word: `src/lib/case-export/docx.ts` (docx).** Remove `shading` from the
alternate data rows' cells. On the heading row's cells:

```ts
shading: { type: ShadingType.CLEAR, color: "auto", fill: "EFE5D0" },
```

## Office details in the header: no change needed

The ink header band already takes each office's own details from its
record: name (`partner.branding.officeName || partner.name`), contact
person, city, state and phone. An office sees its own name, never another
office's. A global admin edits them in Admin → Partners → the office
(Chambers Name, Contact Name, Phone, City, State). On the web, a branding
office name, if one is set, takes priority over the chambers name. If any
office's export shows another office's name, that's a bug worth reporting
with the account it happened on.

## Check

1. Export the Case Vault (a filter, and a hand-picked selection) as PDF,
   Word and Excel; export Hearing Track as PDF.
2. Rows 2, 4, 6… are white like the rest. Only the heading row is tinted.
3. On a report longer than one page, page 2's heading row looks the same as
   page 1's.
4. Print one PDF in black and white: the heading row is still clearly a
   heading, and no row is greyed out.
