const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CypressSharedWebpackPlugin } = require('./cypress-shared-webpack');

module.exports = {
    mode: 'development',
    entry: './test-app/app.js',
    output: {
        filename: 'bundle.js',
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './test-app/index.html',
        }),
        new CypressSharedWebpackPlugin(),
    ],
};
