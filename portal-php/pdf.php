<?php
/* Minimal PDF writer + lab report layout. No libraries needed (works on any shared host).
   Uses the built-in Helvetica fonts, so text is limited to Latin characters (Rs. is written for the rupee sign). */

class MiniPdf {
  const W = 595.28, H = 841.89;
  // Helvetica / Helvetica-Bold widths for ASCII 32..126 (1/1000 em)
  private static $WR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  private static $WB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
  public $pages = [];
  private $cur = '';
  private $logo = null;

  public function __construct($logoPath = '') {
    if ($logoPath && is_file($logoPath) && ($info = @getimagesize($logoPath)) && $info[2] === IMAGETYPE_JPEG) {
      $this->logo = ['data' => file_get_contents($logoPath), 'w' => $info[0], 'h' => $info[1]];
    }
    $this->addPage();
  }
  public function addPage() { if ($this->cur !== '' || $this->pages) $this->pages[] = $this->cur; $this->cur = ''; }
  public function pageCount() { return count($this->pages) + 1; }
  public static function enc($s) {
    $s = str_replace(["\u{20B9}", "\u{2265}", "\u{2264}", "\u{00A0}"], ['Rs.', '>=', '<=', ' '], (string)$s);
    return mb_convert_encoding($s, 'Windows-1252', 'UTF-8');
  }
  public static function width($s, $size, $bold = false) {
    $t = $bold ? self::$WB : self::$WR; $w = 0; $e = self::enc($s);
    for ($i = 0, $n = strlen($e); $i < $n; $i++) { $c = ord($e[$i]); $w += ($c >= 32 && $c <= 126) ? $t[$c - 32] : 556; }
    return $w * $size / 1000;
  }
  public function wrap($s, $maxW, $size, $bold = false) {
    $lines = [];
    foreach (preg_split('/\R/u', (string)$s) as $para) {
      $cur = '';
      foreach (preg_split('/\s+/u', trim($para)) as $word) {
        if ($word === '') continue;
        $try = $cur === '' ? $word : $cur . ' ' . $word;
        if (self::width($try, $size, $bold) <= $maxW) { $cur = $try; continue; }
        if ($cur !== '') $lines[] = $cur;
        while (self::width($word, $size, $bold) > $maxW && mb_strlen($word) > 1) {   // very long word
          $k = mb_strlen($word); while ($k > 1 && self::width(mb_substr($word, 0, $k), $size, $bold) > $maxW) $k--;
          $lines[] = mb_substr($word, 0, $k); $word = mb_substr($word, $k);
        }
        $cur = $word;
      }
      $lines[] = $cur;
    }
    return $lines ?: [''];
  }
  private static function esc($s) { return str_replace(['\\', '(', ')', "\r"], ['\\\\', '\\(', '\\)', ''], self::enc($s)); }
  private static function n($v) { return rtrim(rtrim(number_format($v, 2, '.', ''), '0'), '.'); }
  /** y is measured from the top of the page (baseline). */
  public function text($x, $y, $s, $size = 10, $bold = false, $rgb = [0.1, 0.15, 0.16]) {
    $this->cur .= sprintf("BT /%s %s Tf %s %s %s rg %s %s Td (%s) Tj ET\n", $bold ? 'F2' : 'F1', self::n($size), self::n($rgb[0]), self::n($rgb[1]), self::n($rgb[2]), self::n($x), self::n(self::H - $y), self::esc($s));
  }
  public function textRight($xr, $y, $s, $size = 10, $bold = false, $rgb = [0.1, 0.15, 0.16]) { $this->text($xr - self::width($s, $size, $bold), $y, $s, $size, $bold, $rgb); }
  public function textCenter($xc, $y, $s, $size = 10, $bold = false, $rgb = [0.1, 0.15, 0.16]) { $this->text($xc - self::width($s, $size, $bold) / 2, $y, $s, $size, $bold, $rgb); }
  public function rect($x, $y, $w, $h, $rgb) { $this->cur .= sprintf("%s %s %s rg %s %s %s %s re f\n", self::n($rgb[0]), self::n($rgb[1]), self::n($rgb[2]), self::n($x), self::n(self::H - $y - $h), self::n($w), self::n($h)); }
  public function line($x1, $y1, $x2, $y2, $rgb = [0.8, 0.85, 0.85], $wd = 0.6) { $this->cur .= sprintf("%s %s %s RG %s w %s %s m %s %s l S\n", self::n($rgb[0]), self::n($rgb[1]), self::n($rgb[2]), self::n($wd), self::n($x1), self::n(self::H - $y1), self::n($x2), self::n(self::H - $y2)); }
  public function logo($x, $y, $w) {
    if (!$this->logo) return;
    $h = $w * $this->logo['h'] / $this->logo['w'];
    $this->cur .= sprintf("q %s 0 0 %s %s %s cm /Im1 Do Q\n", self::n($w), self::n($h), self::n($x), self::n(self::H - $y - $h));
  }
  public function hasLogo() { return (bool)$this->logo; }
  /** Called last: $footer(pdf, pageNo, total) can draw on each page. */
  public function output($footer = null) {
    $this->pages[] = $this->cur; $this->cur = '';
    $total = count($this->pages);
    if ($footer) for ($i = 0; $i < $total; $i++) { $this->cur = ''; $footer($this, $i + 1, $total); $this->pages[$i] .= $this->cur; }
    $obj = [];
    $obj[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    $kids = []; $first = $this->logo ? 6 : 5;
    for ($i = 0; $i < $total; $i++) $kids[] = ($first + $i * 2) . ' 0 R';
    $obj[2] = '<< /Type /Pages /Kids [' . implode(' ', $kids) . '] /Count ' . $total . ' >>';
    $obj[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    $obj[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    if ($this->logo) $obj[5] = ['<< /Type /XObject /Subtype /Image /Width ' . $this->logo['w'] . ' /Height ' . $this->logo['h'] . ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' . strlen($this->logo['data']) . ' >>', $this->logo['data']];
    $res = '<< /Font << /F1 3 0 R /F2 4 0 R >>' . ($this->logo ? ' /XObject << /Im1 5 0 R >>' : '') . ' >>';
    foreach ($this->pages as $i => $content) {
      $po = $first + $i * 2;
      $obj[$po] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources ' . $res . ' /Contents ' . ($po + 1) . ' 0 R >>';
      $obj[$po + 1] = ['<< /Length ' . strlen($content) . ' >>', $content];
    }
    $out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"; $off = [];
    ksort($obj);
    foreach ($obj as $id => $o) {
      $off[$id] = strlen($out);
      if (is_array($o)) $out .= $id . " 0 obj\n" . $o[0] . "\nstream\n" . $o[1] . "\nendstream\nendobj\n";
      else $out .= $id . " 0 obj\n" . $o . "\nendobj\n";
    }
    $max = max(array_keys($obj)); $x = strlen($out);
    $out .= "xref\n0 " . ($max + 1) . "\n0000000000 65535 f \n";
    for ($i = 1; $i <= $max; $i++) $out .= sprintf("%010d 00000 n \n", $off[$i]);
    $out .= "trailer\n<< /Size " . ($max + 1) . " /Root 1 0 R >>\nstartxref\n" . $x . "\n%%EOF";
    return $out;
  }
}

/* ---------- the lab report ---------- */
const LAB_NAME = 'TRINETRI DIAGNOSTICS';
const LAB_ADDR = 'K C Rani Road, 3rd Cross Rd, Betageri, Karnataka 582101';
const LAB_PHONE = 'Phone / WhatsApp: +91 91873 15972';

function rpt_dt($ms) { return $ms ? date('d M Y, h:i a', (int)floor($ms / 1000)) : '-'; }

/** $o = order row (+ keys name, age, sex, code, ref_doctor, created, times json), $sections = [{title,rows:[{name,value,unit,ref,flag}],comment}],
    $meta = ['draft'=>bool, 'by'=>name, 'title'=>qualification, 'at'=>ms] */
function buildReportPdf($o, $sections, $meta) {
  $teal = [0.247, 0.482, 0.510]; $ink = [0.1, 0.15, 0.16]; $gray = [0.4, 0.45, 0.46]; $red = [0.74, 0.12, 0.1];
  $L = 40; $R = MiniPdf::W - 40; $bottom = MiniPdf::H - 62;
  $pdf = new MiniPdf(__DIR__ . '/logo.jpg');
  $times = json_decode(isset($o['times']) ? $o['times'] : '{}', true) ?: [];
  $sexTxt = ['M' => 'Male', 'F' => 'Female', 'O' => 'Other'];
  $ageSex = trim(($o['age'] !== null && $o['age'] !== '' ? $o['age'] . ' Years' : '') . (!empty($o['sex']) ? ' / ' . ($sexTxt[$o['sex']] ?? $o['sex']) : ''), ' /');

  $head = function ($first) use ($pdf, $teal, $gray, $ink, $red, $L, $R, $o, $meta, $times, $ageSex) {
    if ($first) {
      $pdf->logo($L, 28, 46);
      $x = $pdf->hasLogo() ? $L + 56 : $L;
      $pdf->text($x, 50, LAB_NAME, 19, true, $teal);
      $pdf->text($x, 64, LAB_ADDR, 8.5, false, $gray);
      $pdf->text($x, 75, LAB_PHONE, 8.5, false, $gray);
      $pdf->textRight($R, 48, 'LABORATORY REPORT', 11, true, $ink);
      if (!empty($meta['draft'])) $pdf->textRight($R, 62, 'DRAFT - NOT APPROVED', 10, true, $red);
      $pdf->line($L, 90, $R, 90, $teal, 1.4);
      $pdf->rect($L, 98, $R - $L, 74, [0.95, 0.97, 0.97]);
      $rows = [
        ['Patient name', $o['name'] ?: '-', 'Order ID', $o['code']],
        ['Age / Sex', $ageSex ?: '-', 'Registered', rpt_dt($o['created'])],
        ['Mobile', $o['mobile'] ?: '-', 'Sample collected', rpt_dt(isset($times['collected']) ? $times['collected'] : 0)],
        ['Referred by', $o['ref_doctor'] ?: 'Self', 'Reported', !empty($meta['draft']) ? 'Pending approval' : rpt_dt(isset($meta['at']) ? $meta['at'] : 0)],
      ];
      foreach ($rows as $i => $r) {
        $y = 114 + $i * 16;
        $pdf->text($L + 10, $y, $r[0], 8.5, false, $gray); $pdf->text($L + 82, $y, $r[1], 10, true, $ink);
        $pdf->text($L + 285, $y, $r[2], 8.5, false, $gray); $pdf->text($L + 365, $y, $r[3], 10, true, $ink);
      }
      return 190;
    }
    $pdf->text($L, 40, LAB_NAME, 10, true, $teal);
    $pdf->textRight($R, 40, ($o['name'] ?: '') . '   |   ' . $o['code'], 9, false, $gray);
    $pdf->line($L, 48, $R, 48, $teal, 0.8);
    return 64;
  };

  $cols = ['name' => $L + 6, 'res' => 246, 'flag' => 318, 'unit' => 338, 'ref' => 408];
  $y = $head(true);
  $tableHead = function ($y) use ($pdf, $cols, $gray, $R, $L) {
    $pdf->text($cols['name'], $y, 'TEST', 8, true, $gray); $pdf->text($cols['res'], $y, 'RESULT', 8, true, $gray);
    $pdf->text($cols['unit'], $y, 'UNIT', 8, true, $gray); $pdf->text($cols['ref'], $y, 'REFERENCE RANGE', 8, true, $gray);
    $pdf->line($L, $y + 4, $R, $y + 4, [0.75, 0.8, 0.8], 0.6);
    return $y + 16;
  };
  $secHead = function ($y, $title) use ($pdf, $L, $R, $teal) {
    $pdf->rect($L, $y - 12, $R - $L, 19, [0.86, 0.92, 0.93]);
    $pdf->text($L + 6, $y + 1, mb_strtoupper($title), 10, true, $teal);
    return $y + 22;
  };

  foreach ($sections as $sec) {
    $rows = array_values(array_filter($sec['rows'], function ($r) { return trim((string)$r['value']) !== ''; }));
    if (!$rows && trim((string)($sec['comment'] ?? '')) === '') continue;
    if ($y + 70 > $bottom) { $pdf->addPage(); $y = $head(false); }
    $y = $secHead($y + 6, $sec['title']);
    $y = $tableHead($y);
    foreach ($rows as $r) {
      $flag = (string)($r['flag'] ?? ''); $abn = $flag !== '';
      $nl = $pdf->wrap($r['name'], 190, 9.5, false); $rl = $pdf->wrap((string)$r['ref'], 142, 8.5, false); $vl = $pdf->wrap((string)$r['value'], 68, 9.5, true);
      $h = max(count($nl) * 12, count($rl) * 11, count($vl) * 12) + 6;
      if ($y + $h > $bottom) { $pdf->addPage(); $y = $head(false); $y = $secHead($y, $sec['title'] . ' (continued)'); $y = $tableHead($y); }
      foreach ($nl as $i => $s) $pdf->text($cols['name'], $y + $i * 12, $s, 9.5, false, $ink);
      foreach ($vl as $i => $s) $pdf->text($cols['res'], $y + $i * 12, $s, 9.5, $abn, $abn ? $red : $ink);
      if ($abn) $pdf->text($cols['flag'], $y, $flag, 9.5, true, $red);
      $pdf->text($cols['unit'], $y, (string)$r['unit'], 8.5, false, $gray);
      foreach ($rl as $i => $s) $pdf->text($cols['ref'], $y + $i * 11, $s, 8.5, false, $gray);
      $y += $h; $pdf->line($L, $y - 8, $R, $y - 8, [0.92, 0.94, 0.94], 0.4);
    }
    $c = trim((string)($sec['comment'] ?? ''));
    if ($c !== '') {
      foreach ($pdf->wrap('Note: ' . $c, $R - $L - 12, 9, false) as $ln) { if ($y > $bottom) { $pdf->addPage(); $y = $head(false); } $pdf->text($L + 6, $y, $ln, 9, false, $ink); $y += 12; }
    }
    $y += 4;
  }

  if ($y + 96 > $bottom) { $pdf->addPage(); $y = $head(false); }
  $y += 14;
  $pdf->textCenter(MiniPdf::W / 2, $y, '*** End of report ***', 9, true, $gray);
  $y += 24;
  $pdf->text($L, $y, 'Results relate only to the sample received. Please correlate clinically.', 8, false, $gray);
  $pdf->text($L, $y + 11, 'Values outside the reference range are marked H (high), L (low) or A (abnormal).', 8, false, $gray);
  if (empty($meta['draft']) && !empty($meta['by'])) {
    $pdf->textRight($R, $y + 4, $meta['by'], 10.5, true, $ink);
    if (!empty($meta['title'])) $pdf->textRight($R, $y + 16, $meta['title'], 8.5, false, $gray);
    $pdf->textRight($R, $y + 27, 'Electronically verified ' . rpt_dt(isset($meta['at']) ? $meta['at'] : 0), 8, false, $gray);
  }
  return $pdf->output(function ($p, $n, $t) use ($L, $R, $gray, $teal) {
    $p->line($L, MiniPdf::H - 44, $R, MiniPdf::H - 44, $teal, 0.8);
    $p->textCenter(MiniPdf::W / 2, MiniPdf::H - 31, LAB_NAME . '  |  ' . LAB_ADDR . '  |  ' . LAB_PHONE, 7.5, false, $gray);
    $p->textRight($R, MiniPdf::H - 19, 'Page ' . $n . ' of ' . $t, 8, false, $gray);
  });
}
