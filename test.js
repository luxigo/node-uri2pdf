//var trace=require('njstrace').inject();
var uri2pdf=require('./uri2pdf.js');

var u2p=uri2pdf({
  callback: function(e){
    console.log(e);
    switch(e.type) {
      case 'ready':
        this.enqueue({
          uri: process.argv[2],
          outfile: '/tmp/out.pdf'
        });
        break;
      case 'end':
        process.exit(0);
        break;
    }
  }
});

u2p.on('ready',function(){});
