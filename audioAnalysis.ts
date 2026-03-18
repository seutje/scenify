import { AudioAnalysisSegment, AudioAnalysisSummary, AudioEnergyLevel, AudioTrend } from './types';

type TimelineEntry = {
  timestamp: string;
  startSeconds: number;
  endSeconds: number;
};

const round = (value: number, decimals: number = 3): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

export const formatTimestamp = (seconds: number): string => {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export const buildStoryboardTimeline = (
  durationSeconds: number,
  firstClipLength: number,
  interval: number
): TimelineEntry[] => {
  const safeDuration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  const safeFirstClipLength = Math.max(1, firstClipLength || 10);
  const safeInterval = Math.max(0.1, interval || 5);
  const startPoints = [0];

  if (safeDuration > 0) {
    let nextStart = safeFirstClipLength;
    while (nextStart < safeDuration - 0.001) {
      startPoints.push(nextStart);
      nextStart += safeInterval;
    }
  }

  return startPoints.map((startSeconds, index) => ({
    timestamp: formatTimestamp(startSeconds),
    startSeconds,
    endSeconds: index < startPoints.length - 1 ? startPoints[index + 1] : safeDuration
  }));
};

const classifyEnergy = (value: number): AudioEnergyLevel => {
  if (value < 0.08) return 'low';
  if (value < 0.18) return 'medium';
  return 'high';
};

const classifyTrend = (start: number, end: number): AudioTrend => {
  const baseline = Math.max(start, 0.01);
  const ratio = end / baseline;
  if (ratio > 1.15) return 'rising';
  if (ratio < 0.85) return 'falling';
  return 'steady';
};

const estimateBpm = (audioBuffer: AudioBuffer): number | undefined => {
  const windowSize = 1024;
  const envelopeRate = audioBuffer.sampleRate / windowSize;
  const frameCount = Math.floor(audioBuffer.length / windowSize);

  if (frameCount < 32 || envelopeRate <= 0) {
    return undefined;
  }

  const channelData = Array.from({ length: audioBuffer.numberOfChannels }, (_, idx) => audioBuffer.getChannelData(idx));
  const envelope = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * windowSize;
    const end = Math.min(start + windowSize, audioBuffer.length);
    let sum = 0;
    let count = 0;

    for (let sampleIndex = start; sampleIndex < end; sampleIndex++) {
      let mixed = 0;
      for (let channel = 0; channel < channelData.length; channel++) {
        mixed += channelData[channel][sampleIndex];
      }
      mixed /= channelData.length || 1;
      sum += Math.abs(mixed);
      count++;
    }

    envelope[frame] = count > 0 ? sum / count : 0;
  }

  const mean = envelope.reduce((total, value) => total + value, 0) / envelope.length;
  const onset = new Float32Array(Math.max(0, envelope.length - 1));
  for (let i = 1; i < envelope.length; i++) {
    onset[i - 1] = Math.max(0, envelope[i] - envelope[i - 1] - mean * 0.02);
  }

  const minLag = Math.max(1, Math.floor((60 / 180) * envelopeRate));
  const maxLag = Math.max(minLag + 1, Math.ceil((60 / 70) * envelopeRate));

  let bestLag = 0;
  let bestScore = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = 0; i < onset.length - lag; i++) {
      score += onset[i] * onset[i + lag];
    }
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (!bestLag || bestScore <= 0) {
    return undefined;
  }

  return Math.round((60 * envelopeRate) / bestLag);
};

const analyzeWindow = (
  audioBuffer: AudioBuffer,
  timelineEntry: TimelineEntry
): AudioAnalysisSegment => {
  const channelData = Array.from({ length: audioBuffer.numberOfChannels }, (_, idx) => audioBuffer.getChannelData(idx));
  const startFrame = Math.max(0, Math.floor(timelineEntry.startSeconds * audioBuffer.sampleRate));
  const endFrame = Math.max(startFrame + 1, Math.min(audioBuffer.length, Math.floor(timelineEntry.endSeconds * audioBuffer.sampleRate)));
  const frameSpan = endFrame - startFrame;
  const step = Math.max(1, Math.floor(frameSpan / 6000));

  let sumSquares = 0;
  let count = 0;
  let peak = 0;
  let firstHalfSum = 0;
  let firstHalfCount = 0;
  let secondHalfSum = 0;
  let secondHalfCount = 0;

  for (let sampleIndex = startFrame; sampleIndex < endFrame; sampleIndex += step) {
    let mixed = 0;
    for (let channel = 0; channel < channelData.length; channel++) {
      mixed += channelData[channel][sampleIndex];
    }
    mixed /= channelData.length || 1;

    const absValue = Math.abs(mixed);
    peak = Math.max(peak, absValue);
    sumSquares += mixed * mixed;
    count++;

    if (sampleIndex < startFrame + frameSpan / 2) {
      firstHalfSum += absValue;
      firstHalfCount++;
    } else {
      secondHalfSum += absValue;
      secondHalfCount++;
    }
  }

  const averageIntensity = count > 0 ? Math.sqrt(sumSquares / count) : 0;
  const firstHalfAverage = firstHalfCount > 0 ? firstHalfSum / firstHalfCount : averageIntensity;
  const secondHalfAverage = secondHalfCount > 0 ? secondHalfSum / secondHalfCount : averageIntensity;

  return {
    timestamp: timelineEntry.timestamp,
    startSeconds: round(timelineEntry.startSeconds, 2),
    endSeconds: round(timelineEntry.endSeconds, 2),
    averageIntensity: round(averageIntensity),
    peakIntensity: round(peak),
    energy: classifyEnergy(averageIntensity),
    trend: classifyTrend(firstHalfAverage, secondHalfAverage)
  };
};

export const summarizeAudioForStoryboard = (
  audioBuffer: AudioBuffer,
  interval: number,
  firstClipLength: number
): AudioAnalysisSummary => {
  const durationSeconds = audioBuffer.duration;
  const timeline = buildStoryboardTimeline(durationSeconds, firstClipLength, interval);
  const segments = timeline.map((entry) => analyzeWindow(audioBuffer, entry));
  const overallAverage = segments.reduce((total, segment) => total + segment.averageIntensity, 0) / Math.max(segments.length, 1);
  const minSegment = segments.reduce((min, segment) => Math.min(min, segment.averageIntensity), Number.POSITIVE_INFINITY);
  const maxSegment = segments.reduce((max, segment) => Math.max(max, segment.averageIntensity), 0);
  const strongestSegments = [...segments]
    .sort((a, b) => b.peakIntensity - a.peakIntensity)
    .slice(0, 3)
    .map((segment) => `${segment.timestamp} (${segment.energy} energy, ${segment.trend} dynamics)`);

  return {
    durationSeconds: round(durationSeconds, 2),
    overallEnergy: classifyEnergy(overallAverage),
    dynamicRange: classifyEnergy(Math.max(0, maxSegment - (Number.isFinite(minSegment) ? minSegment : 0))),
    estimatedBpm: estimateBpm(audioBuffer),
    segments,
    notableMoments: strongestSegments
  };
};
