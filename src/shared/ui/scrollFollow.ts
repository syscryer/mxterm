export interface ScrollMetrics {
  top: number;
  height: number;
  viewport: number;
}

const bottomTolerance = 1;
const resumeThreshold = 32;

function bottomGap(metrics: ScrollMetrics) {
  return Math.max(0, metrics.height - metrics.top - metrics.viewport);
}

export class ScrollFollowController {
  following = true;
  private previous: ScrollMetrics | null = null;

  record(metrics: ScrollMetrics) {
    this.previous = metrics;
  }

  pause(metrics: ScrollMetrics) {
    this.following = false;
    this.record(metrics);
  }

  resume() {
    this.following = true;
    this.previous = null;
  }

  onScroll(metrics: ScrollMetrics) {
    const previous = this.previous;
    const geometryChanged = previous !== null &&
      (metrics.height !== previous.height || metrics.viewport !== previous.viewport);
    const movedUp = previous !== null && metrics.top < previous.top - bottomTolerance;
    const movedDown = previous !== null && metrics.top > previous.top + bottomTolerance;
    const gap = bottomGap(metrics);

    // 内容增长、视口缩放和浏览器滚动锚定不代表用户离开了底部。
    if (movedUp && !geometryChanged) {
      this.following = false;
    } else if (!this.following && previous && (
      (movedDown && !geometryChanged && gap <= resumeThreshold) ||
      (gap <= bottomTolerance && bottomGap(previous) > bottomTolerance)
    )) {
      this.following = true;
    }
    this.record(metrics);
    return this.following;
  }
}
