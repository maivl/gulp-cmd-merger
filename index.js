var Promise = require('promise' ),
    fs = require('fs' ),
    path = require('path' ),
    through = require('through2' ),
    gutil = require('gulp-util' ),

    rFirstStr = /[\s\r\n\=]/,
    rDefine = /define\(\s*(['"](.+?)['"],)?/,
    rDeps = /(['"])(.+?)\1/g,
    rAlias = /alias\s*\:([^\}]+)\}/,
    rPaths = /paths\s*\:([^\}]+)\}/,
    rVars = /vars\s*\:([^\}]+)\}/,
    rVar = /\{([^{]+)}/g,
    rSeajsConfig = /seajs\.config\([^\)]+\);?/g,
    rModId = /([^\\\/?]+?)(\.(?:js))?([\?#].*)?$/,
    rQueryHash = /[\?#].*$/,
    rExistId = /define\(\s*['"][^\[\('"\{\r\n]+['"]\s*,?/,
    rSeajsUse = /"(?:\\"|[^"])*"|'(?:\\'|[^'])*'|\/\*[\S\s]*?\*\/|\/(?:\\\/|[^\/\r\n])+\/(?=[^\/])|\/\/.*|\.\s*seajs\.use|(?:^|[^$])\bseajs\.use\s*\((.+)/g,

    rRequire = /"(?:\\"|[^"])*"|'(?:\\'|[^'])*'|\/\*[\S\s]*?\*\/|\/(?:\\\/|[^\/\r\n])+\/(?=[^\/])|\/\/.*|\.\s*require|(?:^|[^$])\brequire\s*\(\s*(["'])(.+?)\1\s*\)/g;

const PLUGIN_NAME = 'gulp-cmd-merger';

var APP= {
    base: "./",
    fileName: "./",
    filePath: "./",
    fileBase: "./",
    currentDeps: [],
    allContents: {}, //以path为key的对象，包含contnet
}


/**
    step1 入口文件
 */
createStream = function(options ){
    var self= this;
    return through.obj(function(file, enc, callback ){
        APP.base= file.cwd;
        APP.fileName= path.dirname(file.path);
        APP.filePath= file.path;
        APP.fileBase= file.base;
        APP.currentDeps= []; //reset
        //top dep
        var topContents= file.contents.toString();
        var dep= fn_formatDep(APP.filePath, true);
        APP.currentDeps.push(dep);
        //
        if (file.isNull() ){

        }else if(file.isBuffer() ){
            fn_parseContent(topContents, dep.seaId).then(function(){
                var _content= fn_concatContents();
                file.contents= new Buffer(_content);
                //gutil.log(PLUGIN_NAME + ':', '✔ Module [' + option.mainId + '] combo success.');
                callback(null, file);
            });
            return;
        }else if(file.isStream() ){
            //file.contents= file.contents.pipe( );
        }else{
            
        }
        this.push(file);
        callback(null, file);
    });
}

/**
    step2 解析文件
 */
function fn_parseContent(_contents, seaId){
    return new Promise(function(done){
        if(!_contents|| (seaId in APP.allContents) ){
            return done();
        };
        APP.allContents[seaId]= true;
        var dep= null;
            origId= null,
            flag= false,
            subDeps= [],
            subDepIds= [];
            _defineHeader= 'define("'+ seaId+'", ';
        _contents= _contents.replace(rRequire, function($1, $2, $3){
            if($3){
                origId = $3;
                dep= fn_formatDep(origId);
                subDeps.push(dep);
                subDepIds.push(dep.seaId);
                APP.currentDeps.push(dep);
                flag= true;
                return '\trequire("'+ dep.seaId+ '")';
            }else{
                return $1;
            }
        });
        if(subDepIds.length){
            _defineHeader+= '["'+ subDepIds.join('","')+ '"], ';
        }
        _contents= _contents.replace(rDefine, _defineHeader);
         APP.allContents[seaId]= {
            contents: _contents,
            subDeps: subDeps
        };
        if(flag){
            done(fn_parseDependencies() );
        }else{
            done();
        }
    });
}

/**
    格式化路径
    seajs的路径格式：
        _._.._/_abc____
        1）相对标识（以 .or.. 开头，只出现在模块环境中（define 的 factory 方法里面）。相对标识永远相对当前模块的 URI 来解析
        2）顶级标识（不以点（.）或斜线（/）开始， 会相对模块系统的基础路径（即 Sea.js 的 base 路径）来解析
        3）普通路径（除了相对和顶级标识之外的标识都是普通路径。普通路径的解析规则，和 HTML 代码中的 <script src="..."></script> 一样，会相对当前页面解析
 */
function fn_formatDep(origId, top){
    var dep= {
        origId: origId,
        seaId: "",
        path: ""
    },
    _prePath= "";
    if(top){
        dep.path= origId;
    }else{
        type= origId.charAt(0);
        switch(type){
            case ".":
                _prePath= APP.fileName;
            break;
            case "/":
                origId= origId.slice(1);
            default:
                _prePath= APP.fileBase;
            break;
        }
        dep.path= path.resolve(_prePath, origId);
    }
    dep.path= dep.path.replace(/\.[jsJS\s]*$/, "");
    dep.seaId= dep.path.replace(APP.base+ "/", "");
    return dep;
}
 /**
    step3 提取依赖
 */
function fn_parseDependencies(){
    var _promises= APP.currentDeps.map(function(dep, k){
        return new Promise(function(done){
            if(dep.seaId in APP.allContents){
                APP.currentDeps= APP.currentDeps.concat(APP.allContents[dep.seaId].subDeps);
                done();
            }else{
                var _contents= "";
                try{
                    _contents = fs.readFileSync(dep.path+".js", "utf-8");
                }catch(e){
                    console.log(APP.filePath);
                    console.log(e);
                }
                done(fn_parseContent(_contents, dep.seaId) );
            }
        });
    });
    //
    return Promise.all(_promises);
}
 /**
    step4 合并
 */
 function fn_concatContents(){
    var _dep= null,
        _dep_contents= "",
        _contents= "";
    var ks= {};
    while(_dep= APP.currentDeps.shift() ){
        if(_dep.seaId in ks){
            continue;
        }
        ks[_dep.seaId]= _dep.seaId;
        _dep_contents= APP.allContents[_dep.seaId].contents;
        _contents+= _dep_contents+ "\n";

    }
    return new Buffer(_contents);
 }

 /**
    step5 id重命名
 */
function fn_resetIds(){

}


module.exports = createStream;