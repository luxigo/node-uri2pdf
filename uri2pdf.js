"use strict";

var phantom=require('phantom');
var extend=require('extend');
var EventEmitter=require('events');
var util=require('util');

/**
 * @object uri2pdf
 *
 * Convert URIs to PDF
 *
 * On init a phantomjs session is started,
 * then a 'ready' event is emited when the session is started (you can catch events in the callback).
 * Once the session is started you can use uri2pdf.enqueue() or uri2pdf.convert()
 * See test.js for an example
 * 
 * @param options [object] uri2pdf instance properties to set or override
 * @param options.callback [function] will receive event objects from uri2pdf handlers
 *
 * @event ready
 * @descr uri2pdf is ready to process URIs
 * @param event [object]
 * @param event.type [string]
 * @param event.target [object] uripdf instance
 *
 * @event render
 * @descr Report render success or failure
 * @param event [object]
 * @param event.type [string]
 * @param event.target [object] uripdf instance
 * @param event.error [exception] set on failure
 * @param event.options [object] the options you passed to enqueue() or convert()
 *
 * @event end
 * @descr Queue has been processed
 * @param event [object]
 * @param event.type [string]
 * @param event.target [object] uripdf instance
 */
function uri2pdf(options) {
  if (!(this instanceof uri2pdf)) {
    return new uri2pdf(options);
  }
  EventEmitter.call(this);
  extend(true,this,options);
  this.init(options);

} // uri2pdf

util.inherits(uri2pdf,EventEmitter);

extend(true,uri2pdf.prototype,{

  /**
   * @property url2pdf.session
   *
   * When null, the ready event has not yet been emitted
   *
   */
  session: null,

  /**
   * @property uri2pdf.session_type
   *
   * Make some room for (future) electron support
   *
   */
  session_type: 'phantom',

  /**
   * @property uri2pdf.phantom
   *
   */
  phantom: {
    options: {
      phantomOptions: {},
      pageOptions: [
        {
          name: 'paperSize',
          value: {
            format: 'A4'
          }
        }
      ]
    }
  },

  /**
   * @property uri2pdf.queue
   */
  queue: [],

  /**
   * @property uri2pdf.maxDelay
   */
  maxDelay: 30000,

  /**
   * @property uri2pdf.listeners
   *
   * Event listeners
   *
   */
  listeners: [],

  /**
   * @method uri2pdf.dispatch
   */
  dispatch: function uri2pdf_dispatch(e){
    var emitter=this;
    if (typeof(e)=="string") {
      e={
        type: e,
      };
    }
    e.target=emitter;

    // convert arguments to array and discard first one
    var args=Array.prototype.slice.apply(arguments).slice(1);
    var cancel;

    emitter.listeners.some(function uri2pdf_emitter_listener_some(obj){
      var foreignHandler=obj['on_'+emitter.constructor.name+'_'+e.type];
      if (foreignHandler) {
        if (foreignHandler.apply(obj,[e].concat(args))===false) {
          cancel=true;
          return false;
        }
      }
    });

    if (!cancel) {
      var ownHandler=emitter['on'+e.type];
      if (ownHandler) {
        if (ownHandler.apply(emitter,[e].concat(args))===false) {
            return false;
        }
      }
      emitter.emit(e.type,e);
    }

  }, // uri2pdf.dispatch

  /**
   * @method uri2pdf.init
   *
   */
  init: function uri2pdf_init(options) {
    var uri2pdf=this;

    // exit headless browser on process exit
    process.on('exit', function uri2pdf_on_process_exit(code, signal) {
      var session=uri2pdf.session;
      if (session) {
        session.exit();
        uri2pdf.session=null;
      }
    });

    // launch the headless browser
    uri2pdf.startBrowser();

  }, // uri2pdf.init

  /**
   * @method uri2pdf.startBrowser
   *
   * Start the headless browser
   * When callback is omitted, emit ready event to indicate URIs can be submitted
   *
   * @param callback [function] optional callback
   * @emit ready [event] 
   */
  startBrowser: function uri2pdf_startBrowser(callback) {
    var uri2pdf=this;
    if (!uri2pdf.session) {
      switch(uri2pdf.session_type) {
        case 'phantom':
          phantom.create(
            uri2pdf.phantom.options.phantomOptions,
            function uri2pdf_phantom_create_callback(session) {
              uri2pdf.session=session;
              if (callback) {
                callback.call(uri2pdf);
              } else {
                uri2pdf.dispatch('ready');
              }
            }
          );
      }
    } else {
      if (callback) {
        callback();
      } else {
        uri2pdf.dispatch('ready');
      }
    }
  }, // uri2pdf_startBrowser

  /**
   * @method uri2pdf.convert
   *
   * Convert the given URI to PDF and save it at the specified location
   * you can add to options anything you need to pass to the render
   * event handler or callback.
   *
   * @param options [object]
   * @param options.uri [string] URI to convert
   * @param options.outfile [string] output PDF file path
   * @param options.http.headers [object] custom HTTP headers
   * @param options.uptoyou [uptoyou] uptoyou
   *
   * @emit render [event] to indicate success or failure (when event.error is set)
   */
  convert: function uri2pdf_convert(options) {
    var uri2pdf=this;
    var page;

    try {
      uri2pdf.session.createPage(function createPage_callback(_page) {
        page=_page;
        uri2pdf.setTimeout(page,options);

        if (options.http && options.http.headers) {
            page.customHeaders = extend({},options.http.headers);
        }

        page.open(options.uri,function pageOpen_callback(success) {
          clearTimeout(options.timeout);
          if (!success) {
            throw 'page.open failed for '+options.uri;
          }

          var pageOptions=uri2pdf.phantom.options.pageOptions;
          var index=pageOptions.length;

          // recursive loop
          function setNextPageOption(){

            // all options have been set ?
            if (!index) {
              // render and save pdf
              uri2pdf.setTimeout(page,options);
              uri2pdf.saveAsPDF(page,options);
              return;
            }

            // get page option
            --index;
            var option=pageOptions[index];

            // set page option and loop asynchronously
            page.set(option.name,option.value,setNextPageOption);

          } // setNextPageOption

          // enter the loop
          setNextPageOption();

        });

      });

    } catch(e) {
      console.log(e);
      clearTimeout(options.timeout);

      if (page) {
        try {
          page.close();

        } catch(e2) {
          console.log(e2);

         // restart the browser when the page cannot be closed
          uri2pdf.restartBrowser(function(){
            uri2pdf.dispatch({
              type: 'render',
              options: options,
              error: e
            });
          });
          return; 

        }
      }

      uri2pdf.dispatch({
        type: 'render',
        options: options,
        error: e
      });
    }
  }, // uri2pdf.convert

  /**
   * @method uri2pdf.setTimeout()
   */
  setTimeout: function uri2pdf_setTimeout(page,options) {
    var uri2pdf=this;
    options.timeout=setTimeout(function(){
      uri2pdf.abort(page,options);
    },uri2pdf.maxDelay);
  }, // uri2pdf_setTimeout

  /**
   * @method uri2pdf.abort
   */
  abort: function uri2pdf_abort(page,options) {
    var uri2pdf=this;
    try {
      page.close();
    } catch(e) {
      // restart the browser when the page cannot be closed
      uri2pdf.restartBrowser(function(){
        uri2pdf.dispatch({
          type: 'render',
          options: options,
          e: 'timeout'
        });
      });
      return;
    }
    uri2pdf.dispatch({
      type: 'render',
      options: options,
      e: 'timeout'
    });

  }, // uri2pdf_abort

  /**
   * @method uri2pdf.restartBrowser
   */
  restartBrowser: function uri2pdf_restartBrowser(callback){
    var uri2pdf=this;
    uri2pdf.stopBrowser();
    uri2pdf.startBrowser(callback);
  }, // uri2pdf.restartBrowser

  /**
   * @method uri2pdf.restartBrowser
   */
  stopBrowser: function uri2pdf_stopBrowser(){
    var uri2pdf=this;
    if (uri2pdf.session) {
      uri2pdf.session.exit();
      uri2pdf.session=null;
    }
  }, // uri2pdf_stopBrowser

  /**
   * @method uri2pdf.saveAsPDF
   *
   * Render the given browser page, and save it as PDF.
   * You can add to options anything you need to pass to the render
   * event handler or callback.
   *
   * @param options [object]
   * @param options.uri [string] URI to convert
   * @param options.outfile [string] output PDF file path
   * @param options.uptoyou [uptoyou] uptoyou
   *
   * @emit render [event] to indicate success or failure (when event.error is set)
   */
  saveAsPDF: function uri2pdf_saveAsPDF(page,options) {
    var uri2pdf=this;
    page.render(options.outfile, function render_callback() {
      page.close();
      page = null;
      clearTimeout(options.timeout);
      uri2pdf.dispatch({
        type: 'render',
        options: options
      });
    });
  }, // uri2pdf.saveAsPDF

  /**
   * @method uri2pdf.enqueue
   *
   * Store the render options to queue and start processing if needed,
   * you can add to options anything you need to pass to the render
   * event handler or callback.
   *
   * @param options [object] render options
   * @param options.uri [string] URI to render
   * @param options.outfile [string] output PDF file path
   * @param options.uptoyou [uptoyou] uptoyou
   *
   */
  enqueue: function uri2pdf_enqueue(options) {
    var uri2pdf=this;
    uri2pdf.queue.push(options);
    if (!uri2pdf.queue.active) {
      uri2pdf.next();
    }
  }, // uri2pdf.enqueue 
  
  /**
   * @method uri2pdf.onready
   *
   * forward the ready event to optional callback
   *
   */
  onready: function uri2pdf_onready(e) {
    var uri2pdf=this;
    if (uri2pdf.callback) {
      if (uri2pdf.callback(e)===false) {
          return false;
      }
    }
    if (!uri2pdf.queue.active) {
        uri2pdf.next();
    }

  }, // uri2pdf.onready

  /**
   * @method uri2pdf.onrender
   *
   * Forward the render event to optional callback,
   * and process next element in queue unless the callback return false
   *
   * @param e [object] event
   * @param options [object] render options
   */
  onrender: function uri2pdf_onrender(e,options){
    var uri2pdf=this;
    if (uri2pdf.callback) {
      if (uri2pdf.callback(e,options)===false) {
        return false;
      }
    }
    uri2pdf.next();
    
  }, // uri2pdf.onrender

  /**
   * @method uri2pdf.next
   *
   * Convert the next URI in queue
   *
   * @emit end [event] when the queue is empty
   */
  next: function uri2pdf_next(){
    var uri2pdf=this;

    if (uri2pdf.queue.length) {
      uri2pdf.queue.active=true;
      uri2pdf.convert(uri2pdf.queue.shift());

    } else {
      if (uri2pdf.queue.active) {
        uri2pdf.queue.active=false;
        uri2pdf.dispatch('end');
      }
    }

  }, // uri2pdf.next

  /**
   * @method uri2pdf.onend
   * 
   * Forward the end event to optional callback
   *
   * @param e [object]
   */
  onend: function uri2pdf_onend(e) {
    var uri2pdf=this;
    if (uri2pdf.callback) {
      return uri2pdf.callback(e);
    }
  } // uri2pdf.onend

});

module.exports=uri2pdf;

