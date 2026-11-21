// csv-reader 1.0.0-compatible reader, written from scratch for speed.
//
// run(input) answers exactly what csv-reader 1.0.0 returns for the same
// input {text, header}: {columns, rows, errors}. The reading rules:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no
//     record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not
//     doubled ("" inside is one quote; CRLF or a lone CR inside is read
//     as LF); what follows the closing quote up to the next comma or line
//     break is appended as it stands (quote_junk); a quote that never
//     closes is a literal character and the text after it is read again
//     as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows
//     are the records after it (every record when header is false), each
//     padded with "" (short_row, fields: its field count) or cut
//     (long_row, extra: the cut fields) to the first record's width;
//   - each error is {code, line, row} in the order met; line is the
//     1-based line the record starts on, row its index in rows, null
//     for the header.
//
// Speed: quote-free lines take a native split fast path; quoted fields
// find their closing quote with indexOf jumps and only walk a field's
// characters when it holds escapes or newlines.

const QUOTE = 34; // "
const COMMA = 44; // ,
const LF = 10; // \n
const CR = 13; // \r

export function run(input) {
  const header = input.header === true;
  const text = input.text;
  const n = text.length;
  let pos = 0;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  const errors = [];
  const records = [];
  let line = 1;
  let width = 0;
  // The record currently being parsed (readUnquoted needs them).
  let recLine = 1;
  let row = null;

  // readUnquoted parses one unquoted field starting at pos (shared by the
  // plain and the unterminated-quote paths). It advances pos and line,
  // pushes stray_cr errors, and returns 'comma' | 'eol' | 'eof', leaving
  // the field's value in lastValue and whether it held characters in
  // lastTouched. parts, when given, is pre-seeded with literal text
  // (the unterminated quote) and joined at the end.
  let lastValue = '';
  let lastTouched = false;
  function readUnquoted(parts) {
    let acc = parts; // string[] or null
    let val = '';
    let touched = acc !== null && acc.length > 0;
    const add = (tail) => {
      if (tail.length === 0) return;
      touched = true;
      if (acc) acc.push(tail);
      else if (val === '') val = tail;
      else { acc = [val, tail]; val = ''; }
    };
    for (;;) {
      const cIdx = text.indexOf(',', pos);
      const nIdx = text.indexOf('\n', pos);
      const rIdx = text.indexOf('\r', pos);
      const d = minIdx(cIdx, nIdx, rIdx);
      if (d === -1) {
        add(text.slice(pos, n));
        pos = n;
        lastValue = acc ? acc.join('') : val;
        lastTouched = touched;
        return 'eof';
      }
      const dc = text.charCodeAt(d);
      if (dc === COMMA) {
        add(text.slice(pos, d));
        pos = d + 1;
        lastValue = acc ? acc.join('') : val;
        lastTouched = touched;
        return 'comma';
      }
      if (dc === LF) {
        add(text.slice(pos, d));
        pos = d + 1;
        line++;
        lastValue = acc ? acc.join('') : val;
        lastTouched = touched;
        return 'eol';
      }
      // CR: CRLF ends the record; a lone CR is dropped (stray_cr) and
      // the field continues.
      if (d + 1 < n && text.charCodeAt(d + 1) === LF) {
        add(text.slice(pos, d));
        pos = d + 2;
        line++;
        lastValue = acc ? acc.join('') : val;
        lastTouched = touched;
        return 'eol';
      }
      add(text.slice(pos, d));
      errors.push({ code: 'stray_cr', line: recLine, row });
      pos = d + 1;
    }
  }

  // Smallest index >= 0 among the three, or -1 when all are -1.
  const minIdx = (a, b, c) => {
    let m = -1;
    if (a !== -1) m = a;
    if (b !== -1 && (m === -1 || b < m)) m = b;
    if (c !== -1 && (m === -1 || c < m)) m = c;
    return m;
  };

  while (pos < n) {
    // ---- fast path: a whole quote-free line is one record ----
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? n : nl;
    const seg = text.slice(pos, lineEnd);
    const qAt = seg.indexOf('"');
    const rAt = seg.indexOf('\r');
    // A trailing CR is the CRLF terminator only when a LF follows it
    // (nl !== -1); at EOF it is a lone CR and takes the general path.
    if (qAt === -1 && (rAt === -1 || (rAt === seg.length - 1 && nl !== -1))) {
      // No quotes; the only CR, if any, is the CRLF terminator.
      const body = rAt === -1 ? seg : seg.slice(0, -1);
      pos = nl === -1 ? n : nl + 1;
      line++;
      if (body.length === 0) continue; // empty line: no record
      const fields = body.split(',');
      const recIdx = records.length;
      const row = header ? (recIdx === 0 ? null : recIdx - 1) : recIdx;
      if (recIdx === 0) {
        width = fields.length;
        records.push(fields);
      } else if (fields.length < width) {
        errors.push({ code: 'short_row', line: line - 1, row, fields: fields.length });
        while (fields.length < width) fields.push('');
        records.push(fields);
      } else if (fields.length > width) {
        errors.push({ code: 'long_row', line: line - 1, row, extra: fields.slice(width) });
        fields.length = width;
        records.push(fields);
      } else {
        records.push(fields);
      }
      continue;
    }

    // ---- general path: this line holds quotes or a stray CR ----
    recLine = line;
    const recIdx = records.length;
    row = header ? (recIdx === 0 ? null : recIdx - 1) : recIdx;
    const fields = [];
    let hasContent = false;
    let recordDone = false;

    while (!recordDone) {
      // A field just ended on a comma and the next thing is a line
      // break or EOF: the trailing field is empty.
      if (pos >= n) { if (fields.length > 0) fields.push(''); recordDone = true; break; }
      const ch = text.charCodeAt(pos);
      if (ch === LF) { if (fields.length > 0) fields.push(''); pos++; line++; recordDone = true; break; }
      if (ch === CR && pos + 1 < n && text.charCodeAt(pos + 1) === LF) {
        if (fields.length > 0) fields.push(''); pos += 2; line++; recordDone = true; break;
      }

      // Parse one field starting at pos.
      let value;
      let end; // 'comma' | 'eol' | 'eof'
      let touched = false;

      if (ch === QUOTE) {
        // Quoted field: find the closing quote ("" is an escape).
        let scan = pos + 1;
        let close = -1;
        for (;;) {
          const q = text.indexOf('"', scan);
          if (q === -1) break;
          if (q + 1 < n && text.charCodeAt(q + 1) === QUOTE) { scan = q + 2; continue; }
          close = q;
          break;
        }
        if (close === -1) {
          // Unterminated quote: it is a literal character; the text
          // after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recLine, row });
          const parts = ['"'];
          pos = pos + 1;
          end = readUnquoted(parts);
          value = lastValue;
          touched = lastTouched;
        } else {
          const content = text.slice(pos + 1, close);
          let val;
          if (content.indexOf('"') === -1 && content.indexOf('\r') === -1 && content.indexOf('\n') === -1) {
            val = content;
          } else {
            // Slow path: unescape "" and normalise newlines to LF,
            // counting the lines the field spans.
            let out = '';
            let i = 0;
            const m = content.length;
            while (i < m) {
              const c = content.charCodeAt(i);
              if (c === QUOTE) { out += '"'; i += 2; continue; }
              if (c === CR) {
                out += '\n';
                line++;
                i += (i + 1 < m && content.charCodeAt(i + 1) === LF) ? 2 : 1;
                continue;
              }
              if (c === LF) { out += '\n'; line++; i++; continue; }
              out += content[i];
              i++;
            }
            val = out;
          }
          pos = close + 1;
          touched = true;
          // Junk after the closing quote, up to a comma or line break.
          let junk = '';
          let junkParts = null;
          const addJunk = (tail) => {
            if (tail.length === 0) return;
            if (junkParts) junkParts.push(tail);
            else if (junk.length > 0) { junkParts = [junk, tail]; junk = ''; }
            else junk = tail;
          };
          for (;;) {
            const cIdx = text.indexOf(',', pos);
            const nIdx = text.indexOf('\n', pos);
            const rIdx = text.indexOf('\r', pos);
            const d = minIdx(cIdx, nIdx, rIdx);
            if (d === -1) {
              addJunk(text.slice(pos, n));
              pos = n;
              end = 'eof';
              break;
            }
            const dc = text.charCodeAt(d);
            if (dc === COMMA) {
              addJunk(text.slice(pos, d));
              pos = d + 1;
              end = 'comma';
              break;
            }
            if (dc === LF) {
              addJunk(text.slice(pos, d));
              pos = d + 1;
              line++;
              end = 'eol';
              break;
            }
            // CR: CRLF ends the record; a lone CR is dropped (stray_cr)
            // and the junk continues.
            if (d + 1 < n && text.charCodeAt(d + 1) === LF) {
              addJunk(text.slice(pos, d));
              pos = d + 2;
              line++;
              end = 'eol';
              break;
            }
            addJunk(text.slice(pos, d));
            errors.push({ code: 'stray_cr', line: recLine, row });
            pos = d + 1;
          }
          if (junkParts) junk = junkParts.join('');
          if (junk.length > 0) {
            errors.push({ code: 'quote_junk', line: recLine, row });
            value = val + junk;
            touched = true;
          } else {
            value = val;
          }
        }
      } else {
        // Unquoted field.
        const parts = null;
        end = readUnquoted(parts);
        value = lastValue;
        touched = lastTouched;
      }

      fields.push(value);
      if (touched) hasContent = true;
      if (end === 'comma') { hasContent = true; continue; }
      recordDone = true;
    }

    if (!hasContent) continue; // a line left with no characters: no record
    if (recIdx === 0) {
      width = fields.length;
      records.push(fields);
    } else if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row, fields: fields.length });
      while (fields.length < width) fields.push('');
      records.push(fields);
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row, extra: fields.slice(width) });
      fields.length = width;
      records.push(fields);
    } else {
      records.push(fields);
    }
  }

  let columns = null;
  let rows;
  if (records.length === 0) {
    rows = [];
  } else if (header) {
    columns = records[0];
    rows = records.slice(1);
  } else {
    rows = records;
  }
  return { columns, rows, errors };
}
