/* Pipelines storyboard: board layout and arrows. */
(function () {
  'use strict';
  window.Storyboard({
    key: 'pipesb',
    scenes: window.PIPE_SCENES,
    layout: {
      flow: [60, 90, 320], multiflow: [440, 90, 320], rename: [820, 90, 320], stmv: [1200, 90, 320],
      multiplex: [60, 590, 320], sinks: [440, 590, 320], expect: [820, 590, 320], nulls: [1200, 590, 320],
      quarantine: [60, 1090, 320], cdc: [440, 1090, 320], decide: [820, 1090, 320]
    },
    edges: [
      ['flow', 'multiflow', 'many sources'], ['multiflow', 'rename', 'one checkpoint each'], ['rename', 'stmv', 'which target?'],
      ['stmv', 'multiplex', 'one source, many types'], ['multiplex', 'sinks', 'out of the pipeline'], ['sinks', 'expect', 'quality'], ['expect', 'nulls', 'smarter rules'],
      ['nulls', 'quarantine', 'keep every row'], ['quarantine', 'cdc', 'changes over time'], ['cdc', 'decide', '']
    ],
    widgets: []
  });
})();
