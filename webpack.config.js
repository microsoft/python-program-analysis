let path = require('path');

module.exports = {
	mode: 'development',
	entry: path.resolve(__dirname, 'src/index.ts'),
	output: {
		path: path.resolve(__dirname, 'dist/umd'),
		filename: 'index.js',
		library: '',
		libraryTarget: 'commonjs',
		globalObject: 'this'
	},
	node: {
		fs: 'empty',
	},
	module: {
		rules: [
			{
				test: /\.txt/,
				use: ['raw-loader'],
			},
			{
				test: /\.css$/,
				use: ['style-loader', 'css-loader'],
			},
			{
				test: /\.tsx?$/,
				use: ['ts-loader'],
			},
			{
				test: /\.png$/,
				use: ['file-loader'],
			},
		],
	},
	resolve: {
		extensions: ['.ts', '.js', '.tsx', '.jsx', '.css'],
		modules: ['node_modules'],
	}
};
