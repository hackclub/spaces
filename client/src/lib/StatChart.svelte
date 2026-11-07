<script>
  export let title = '';
  export let rows = [];
  export let key = '';
  export let kind = 'bar';
  export let format = (value) => String(value);
  export let detail = null;

  const WIDTH = 360;
  const HEIGHT = 150;
  const LEFT = 44;
  const RIGHT = 8;
  const TOP = 10;
  const BOTTOM = 22;
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;

  let hovered = null;

  function niceStep(span) {
    if (span <= 0) return 1;
    const step = 10 ** Math.floor(Math.log10(span));
    return [1, 2, 2.5, 5, 10].find((n) => n * step >= span) * step;
  }

  function scaleFor(values, fromZero) {
    const high = Math.max(0, ...values);
    if (fromZero) return [0, niceStep(high)];
    const low = Math.min(...values);
    const step = niceStep((high - low) / 2 || 1);
    const bottom = Math.floor(low / step) * step;
    const top = Math.max(Math.ceil(high / step) * step, bottom + step);
    return [bottom, top];
  }

  function shortDay(day) {
    return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  function barPath(x, y, width, height) {
    const r = Math.min(4, width / 2, height);
    return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
  }

  $: values = rows.map((row) => row[key]);
  $: recorded = values.filter((value) => value !== null);
  $: [low, high] = scaleFor(recorded, kind !== 'line');
  $: band = plotWidth / Math.max(rows.length, 1);
  $: barWidth = Math.max(2, Math.min(24, band - 2));
  $: xOf = (i) => LEFT + band * i + band / 2;
  $: yOf = (value) => TOP + plotHeight - ((value - low) / (high - low)) * plotHeight;
  $: firstRecorded = values.findIndex((value) => value !== null);
  $: linePoints = values
    .map((value, i) => (value === null ? null : `${xOf(i)},${yOf(value)}`))
    .filter(Boolean)
    .join(' ');
  $: labelDays = rows.length ? [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])] : [];
  $: hoveredRow = hovered === null ? null : rows[hovered];
  $: tipLeft = hovered === null ? 0 : (xOf(hovered) / WIDTH) * 100;
  $: tipShift = tipLeft < 15 ? '0%' : tipLeft > 85 ? '-100%' : '-50%';
</script>

<div class="chart">
  <h3>{title}</h3>
  {#if recorded.length === 0}
    <p class="chart-empty">Not recorded yet for this period.</p>
  {:else}
    <div class="chart-plot">
      <svg viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-label={title}>
        {#if firstRecorded > 0}
          <rect class="unrecorded" x={LEFT} y={TOP} width={band * firstRecorded} height={plotHeight} />
        {/if}
        {#each [low, (low + high) / 2, high] as tick}
          <line class="grid" x1={LEFT} x2={WIDTH - RIGHT} y1={yOf(tick)} y2={yOf(tick)} />
          <text class="axis" x={LEFT - 6} y={yOf(tick) + 4} text-anchor="end">{format(tick)}</text>
        {/each}
        {#each labelDays as i}
          <text class="axis" x={xOf(i)} y={HEIGHT - 6} text-anchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}>{shortDay(rows[i].day)}</text>
        {/each}

        {#if kind === 'line'}
          <polyline class="line" points={linePoints} />
          {#if recorded.length < 3}
            {#each values as value, i}
              {#if value !== null}
                <circle class="dot" cx={xOf(i)} cy={yOf(value)} r="4" />
              {/if}
            {/each}
          {/if}
          {#if hovered !== null && values[hovered] !== null}
            <line class="crosshair" x1={xOf(hovered)} x2={xOf(hovered)} y1={TOP} y2={TOP + plotHeight} />
            <circle class="dot" cx={xOf(hovered)} cy={yOf(values[hovered])} r="4" />
          {/if}
        {:else}
          {#each values as value, i}
            {#if value}
              <path class="bar" class:dim={hovered !== null && hovered !== i} d={barPath(xOf(i) - barWidth / 2, yOf(value), barWidth, TOP + plotHeight - yOf(value))} />
            {/if}
          {/each}
        {/if}

        {#each rows as row, i}
          <rect
            class="hit"
            x={LEFT + band * i}
            y={TOP}
            width={band}
            height={plotHeight}
            role="presentation"
            on:mouseenter={() => (hovered = i)}
            on:mouseleave={() => (hovered = null)}
          />
        {/each}
      </svg>
      {#if hoveredRow}
        <div class="tooltip" style="left: {tipLeft}%; transform: translateX({tipShift})">
          <strong>{shortDay(hoveredRow.day)}</strong>
          {#if hoveredRow[key] === null}
            <span>Not recorded yet</span>
          {:else}
            <span>{format(hoveredRow[key])}</span>
            {#if detail}<span class="tooltip-detail">{detail(hoveredRow)}</span>{/if}
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .chart {
    padding: 16px;
    border: 1px solid #ddd;
    border-radius: 8px;
    min-width: 0;
  }

  .chart h3 {
    margin: 0 0 8px 0;
    font-size: 14px;
    color: #666;
  }

  .chart-plot {
    position: relative;
  }

  svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }

  .unrecorded {
    fill: #f6f6f6;
  }

  .grid {
    stroke: #eee;
    stroke-width: 1;
  }

  .axis {
    font-size: 10px;
    fill: #888;
  }

  .bar {
    fill: #338eda;
  }

  .bar.dim {
    opacity: 0.45;
  }

  .line {
    fill: none;
    stroke: #338eda;
    stroke-width: 2;
    stroke-linejoin: round;
  }

  .crosshair {
    stroke: #bbb;
    stroke-width: 1;
  }

  .dot {
    fill: #338eda;
    stroke: #fff;
    stroke-width: 2;
  }

  .hit {
    fill: transparent;
  }

  .tooltip {
    position: absolute;
    top: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 6px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
    font-size: 12px;
    white-space: nowrap;
    pointer-events: none;
  }

  .tooltip-detail {
    color: #666;
  }

  .chart-empty {
    margin: 24px 0;
    font-size: 13px;
    color: #888;
    text-align: center;
  }
</style>
