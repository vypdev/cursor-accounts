"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatMembershipType = formatMembershipType;
exports.formatBytes = formatBytes;
/** Format raw membershipType from Cursor API for display. */
function formatMembershipType(membershipType) {
    if (!membershipType?.trim()) {
        return null;
    }
    return membershipType
        .split(/[_\s-]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}
function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return '0 B';
    }
    if (bytes === 0) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** exponent;
    const formatted = value >= 100 || exponent === 0
        ? Math.round(value).toString()
        : value.toFixed(1);
    return `${formatted} ${units[exponent]}`;
}
//# sourceMappingURL=formatters.js.map