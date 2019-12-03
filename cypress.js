const webpack = require('webpack');
const WebpackDevServer = require('webpack-dev-server');
const cypress = require('cypress');
const config = require('./webpack.config.js');

const compiler = webpack(config);

compiler.hooks.invalid.tap('invalid', () => {
    console.log('Compiling...');
});

compiler.hooks.done.tap('done', stats => {
    const messages = stats.toJson({ all: false, warnings: true, errors: true });

    console.log('Compiled', messages.errors.length ? `with ${messages.errors.length} errors` : '');
});

const devServer = new WebpackDevServer(compiler, {
    clientLogLevel: 'none',
    hot: true,
    quiet: true,
    watchOptions: {
        ignored: /node_modules/,
    },
});

console.log('Dev server started...');

[('SIGINT', 'SIGTERM')].forEach(sig => {
    process.on(sig, () => {
        devServer.close();
        process.exit();
    });
});

(async () => {
    await new Promise((resolve, reject) => {
        devServer.listen(8877, 'localhost', err => {
            if (err) {
                reject(err);
                return;
            }

            console.log('Dev server started successfully');
            resolve();
        });
    });

    cypress.open({
        config: {
            baseUrl: 'http://localhost:8877',
        },
        env: process.env,
    });
})();
