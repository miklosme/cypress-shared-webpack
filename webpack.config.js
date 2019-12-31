const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CypressSharedWebpackPlugin } = require('./cypress-shared-webpack');

module.exports = {
    mode: 'development',
    entry: './src/app.js',
    output: {
        filename: 'bundle.js',
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './src/index.html',
        }),
        new CypressSharedWebpackPlugin(),
    ],
};
