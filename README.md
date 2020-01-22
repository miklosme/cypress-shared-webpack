# cypress-shared-webpack

Alternative to [cypress-webpack-preprocessor](https://github.com/cypress-io/cypress-webpack-preprocessor) that aims to use less resources and scale better for bigger projects.
If you ever ran into CPU issues running Cypress with [cypress-webpack-preprocessor](https://github.com/cypress-io/cypress-webpack-preprocessor) then this plugin is for you. It uses the webpack dev server you already have to compile the Cypress tests.

### Benefits:

-   The official solution spins up a second instance of Webpack, which will start it's own file watching, and that is very CPU heavy. This new solution reuses the same resources, that already in use for the dev server.
-   When a developer runs a test, the official solution always recompiles the test files. This makes the waiting for localhost an issue. In case of large `support` files, it can take even ~30-40 second waiting every time before test files can run. The new solution compiles tests when they are changed (normal Webpack file watching), stores result in memory, and just serves it when Cypress asks for it.
-   The official solution required a config for its Webpack instance. The new solution uses the same config, which makes everything more clean, and removes a source of truth problem.

### Implementation

The main plugin file is `cypress-shared-webpack.js` and it contains both a [Webpack plugin](https://webpack.js.org/contribute/writing-a-plugin/#creating-a-plugin) and a [Cypress preprocessor plugin](https://docs.cypress.io/api/plugins/preprocessors-api.html#Examples).

# License

MIT
