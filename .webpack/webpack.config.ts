import { Configuration, Entry } from "webpack"
import * as path from "path"
import { TsConfigPathsPlugin } from "awesome-typescript-loader"
import * as EventHooksPlugin from "event-hooks-webpack-plugin"
import * as shell from "shelljs"
import * as HtmlWebpackPlugin from "html-webpack-plugin"
const WebpackBar = require("webpackbar")
const packageJSON = require("../package.json")
// var nodeExternals = require('webpack-node-externals')
const entry: Entry = {
    index: "./src/index.ts",
}

const titles = {
    index: packageJSON.name,
}

const distPath = path.resolve(__dirname, "../dist")

const conf: Configuration = {
    entry,
    output: {
        path: distPath,
        filename: "[name].[hash].js",
        publicPath: "./",
    },
    target: "electron-renderer",
    resolveLoader: {
        modules: ["node_modules", "./.webpack/loaders"],
    },
    module: {
        rules: [
            {
                test: /\.(ts|js)x?$/,
                use: [
                    // {
                    //     loader: "babel-loader",
                    // },
                    {
                        loader: "awesome-typescript-loader",
                        options: {
                            configFileName: "tsconfig.json",
                            silent: true,
                            // useBabel: true,
                            // useCache: false,
                            // babelCore: "@babel/core",
                            // babelOptions: {
                            //     babelrc: false,
                            //     presets: [["@babel/preset-env", { modules: false }], "@babel/preset-typescript"],
                            //     plugins: ["@babel/proposal-class-properties", "@babel/proposal-object-rest-spread"],
                            // },
                        },
                    },
                ],

                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: [".ts", ".tsx", ".js", ".json"],
        plugins: [
            new TsConfigPathsPlugin({
                configFile: "tsconfig.json",
            }),
        ],
    },
    plugins: [
        new WebpackBar({ name: packageJSON.name, color: "blue" }),
        new EventHooksPlugin({
            beforeRun: () => {
                shell.rm("-rf", distPath + "/*.*")
            },
            done: () => {},
        }),
    ].concat(
        Object.keys(entry).map((name: string) => {
            const exclude = Object.keys(entry).slice()
            exclude.splice(Object.keys(entry).indexOf(name), 1)
            return new HtmlWebpackPlugin({
                filename: name + ".html",
                excludeChunks: exclude,
                template: path.join("src", "template", name + ".ejs"),
                inject: "body",
                title: titles[name],
            })
        }),
    ),
}

export default conf
