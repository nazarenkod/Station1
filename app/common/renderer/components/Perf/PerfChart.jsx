import {useLayoutEffect, useRef, useState} from 'react';

import styles from './Perf.module.css';

const HEIGHT = 96;
const PAD = {left: 52, right: 12, top: 8, bottom: 6};

/**
 * The width of an element, kept up to date as the window resizes.
 */
export function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      return undefined;
    }
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

// a round top for the scale, so the gridlines fall on readable numbers; counts keep a whole middle line
function niceTop(value, whole) {
  if (!(value > 0)) {
    return whole ? 2 : 1;
  }
  const step = 10 ** Math.floor(Math.log10(value));
  const tops = whole ? [2, 4, 10] : [1, 2, 2.5, 5, 10];
  return tops.map((m) => Math.max(m * step, whole ? 2 : 0)).find((candidate) => candidate >= value) ?? 10 * step;
}

/**
 * The line of one measure over time, with gaps where the app was not running.
 */
function linePath(points) {
  let path = '';
  let open = false;
  for (const point of points) {
    if (point.y === null) {
      open = false;
      continue;
    }
    path += `${open ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    open = true;
  }
  return path;
}

/**
 * One measure of the app over time: a thin line in the tool's colour, three
 * gridlines, the screens as bands, the processes starting and ending as
 * dashed lines, and the moment under the pointer, shared by all the charts.
 */
const PerfChart = ({
  label,
  hint,
  samples,
  value,
  format,
  from,
  to,
  floor = 0,
  whole = false,
  segments,
  markers,
  hoverAt,
  onHover,
}) => {
  const [ref, width] = useWidth();
  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const span = Math.max(1, to - from);
  const x = (at) => PAD.left + ((at - from) / span) * plotWidth;

  const shown = samples.filter((sample) => sample.at >= from && sample.at <= to);
  const values = shown.map(value).filter((item) => typeof item === 'number');
  const top = niceTop(Math.max(floor, ...values) * 1.1, whole);
  const y = (item) => PAD.top + plotHeight - (item / top) * plotHeight;
  const points = shown.map((sample) => {
    const item = value(sample);
    return {x: x(sample.at), y: typeof item === 'number' ? y(item) : null};
  });
  const line = linePath(points);
  const last = [...shown].reverse().find((sample) => typeof value(sample) === 'number');

  let hovered = null;
  if (hoverAt !== null && shown.length) {
    hovered = shown.reduce((best, sample) =>
      Math.abs(sample.at - hoverAt) < Math.abs(best.at - hoverAt) ? sample : best,
    );
  }
  const hoveredValue = hovered ? value(hovered) : null;

  const onMove = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const offset = event.clientX - box.left - PAD.left;
    if (offset < 0 || offset > plotWidth) {
      onHover(null);
      return;
    }
    onHover(from + (offset / plotWidth) * span);
  };

  return (
    <div className={styles.chart}>
      <div className={styles.chartHead}>
        <span className={styles.chartLabel}>{label}</span>
        {hint && <span className={styles.chartHint}>{hint}</span>}
        <span className={styles.chartValue}>
          {typeof hoveredValue === 'number' ? format(hoveredValue) : last ? format(value(last)) : '—'}
        </span>
      </div>
      <div ref={ref} className={styles.chartBody}>
        {width > 0 && (
          // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
          <svg
            width={width}
            height={HEIGHT}
            className={styles.svg}
            onMouseMove={onMove}
            onMouseLeave={() => onHover(null)}
            role="img"
            aria-label={label}
          >
            {segments.map((segment, index) => (
              <rect
                key={`${segment.key}-${segment.from}`}
                className={index % 2 ? styles.bandOdd : styles.bandEven}
                x={x(Math.max(segment.from, from))}
                y={PAD.top}
                width={Math.max(0, x(Math.min(segment.to, to)) - x(Math.max(segment.from, from)))}
                height={plotHeight}
              />
            ))}
            {[0, 0.5, 1].map((part) => (
              <g key={part}>
                <line
                  className={styles.grid}
                  x1={PAD.left}
                  x2={PAD.left + plotWidth}
                  y1={y(top * part)}
                  y2={y(top * part)}
                />
                <text className={styles.axis} x={PAD.left - 6} y={y(top * part) + 3} textAnchor="end">
                  {format(top * part)}
                </text>
              </g>
            ))}
            {markers
              .filter((marker) => marker.kind !== 'screen' && marker.at >= from && marker.at <= to)
              .map((marker) => (
                <line
                  key={`${marker.kind}-${marker.pid}-${marker.at}`}
                  className={marker.kind === 'start' ? styles.markStart : styles.markEnd}
                  x1={x(marker.at)}
                  x2={x(marker.at)}
                  y1={PAD.top}
                  y2={PAD.top + plotHeight}
                />
              ))}
            <path className={styles.line} d={line} />
            {hoverAt !== null && (
              <line className={styles.cross} x1={x(hoverAt)} x2={x(hoverAt)} y1={PAD.top} y2={PAD.top + plotHeight} />
            )}
            {hovered && typeof hoveredValue === 'number' && (
              <circle className={styles.dot} cx={x(hovered.at)} cy={y(hoveredValue)} r={4} />
            )}
          </svg>
        )}
      </div>
    </div>
  );
};

export default PerfChart;
