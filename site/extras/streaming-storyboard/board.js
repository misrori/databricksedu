/* Streaming storyboard: board layout and arrows. */
(function () {
  'use strict';
  window.Storyboard({
    key: 'streamsb',
    scenes: window.STREAM_SCENES,
    layout: {
      table: [60, 90, 320], micro: [440, 90, 320], triggers: [820, 90, 320], stateful: [1200, 90, 320],
      eventtime: [60, 590, 320], windows: [440, 590, 320], watermark: [820, 590, 320], modes: [1200, 590, 340],
      matrix: [1200, 1090, 320], joins: [820, 1090, 320], monitor: [440, 1090, 320], lab: [60, 1090, 320]
    },
    edges: [
      ['table', 'micro', 'how it runs'], ['micro', 'triggers', 'when it runs'], ['triggers', 'stateful', 'what it remembers'],
      ['stateful', 'eventtime', 'by which clock?'], ['eventtime', 'windows', 'slice the time'], ['windows', 'watermark', 'when is it final?'],
      ['watermark', 'modes', 'what is written'], ['modes', 'matrix', 'allowed?'], ['matrix', 'joins', ''], ['joins', 'monitor', ''], ['monitor', 'lab', 'try it all']
    ],
    onReset: function () { window.StreamLab.reset(); }
  });
})();
