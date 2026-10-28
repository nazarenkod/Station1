// How the Performance tab writes its numbers: memory in megabytes, CPU in
// percent with a decimal only while it is small.

export const MB = 1024 * 1024;
export const formatMegabytes = (mb) => `${mb >= 100 || mb === 0 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
export const formatBytes = (bytes) => formatMegabytes(bytes / MB);
export const formatPercent = (value) => `${value >= 10 || value === 0 ? value.toFixed(0) : value.toFixed(1)}%`;
export const formatCount = (value) => `${Math.round(value)}`;
