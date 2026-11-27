/* One audio clock for the untouched performance, audition synth and metronome. */
(function(root){
  'use strict';
  class Transport{
    constructor(){this.pos=0;this.layers={recording:true,midi:true,click:false};this.nodes=new Set();this.balance=.33;}
    ensure(){
      if(this.ctx)return this.ctx;
      const c=this.ctx=new AudioContext(),bus=MeleteSynth.createCompressor(c);bus.connect(c.destination);
      this.ref=c.createGain();this.ref.gain.value=.76;this.ref.connect(bus);
      this.guide=c.createGain();this.guide.gain.value=.77;this.guide.connect(bus);
      this.met=c.createGain();this.met.gain.value=.11;this.met.connect(bus);
      this.voice=Object.assign(new MeleteSynth.Voice(),{context:c,wave:MeleteSynth.createWave(c),master:this.guide,
        trackStrips:[],rate:1,scheduled:new Set(),playbackEndSeconds:()=>this.limit});
      return c;
    }
    setEvents(notes,clicks){this.notes=notes;this.clicks=clicks;this.nextNote=this.nextClick=0;
      if(this.playing)this.stopGuide();} // Keep the original recording and its sample clock running through an edit.
    mix(key,on){this.layers[key]=on;if(!this.ctx)return;const gain={recording:this.ref,midi:this.guide,click:this.met}[key].gain;
      gain.setTargetAtTime(on?{recording:Math.cos(this.balance*Math.PI/2),midi:Math.sin(this.balance*Math.PI/2)*.8,click:.11}[key]:0,this.ctx.currentTime,.008);}
    now(){return this.playing?Math.min(this.limit,this.pos+Math.max(0,this.ctx.currentTime-this.zero)):this.pos;}
    seek(t){const play=this.playing;this.stop();this.pos=Math.max(0,Math.min(this.buffer?.duration??Infinity,t));if(play)this.start();}
    start(){
      if(!this.buffer)return;this.stop();const c=this.ensure();
      const range=this.loop?.();if(range&&(this.pos<range[0]||this.pos>=range[1]-.005))this.pos=range[0];
      else if(this.pos>=this.buffer.duration-.005)this.pos=0;
      this.limit=Math.min(this.buffer.duration,range?.[1]??Infinity);
      if(this.pos>=this.limit)return;
      for(const key of Object.keys(this.layers))this.mix(key,this.layers[key]);
      this.zero=c.currentTime+.045;this.playing=true;
      const source=this.source=c.createBufferSource();source.buffer=this.buffer;source.connect(this.ref);
      source.start(this.zero,this.pos,this.limit-this.pos);
      this.nextNote=this.nextClick=0;
      const schedule=()=>{
        if(!this.playing)return;
        const now=this.now(),lead=Math.max(0,this.zero-c.currentTime),h=Math.min(now+.14,this.limit-.00001);
        if(now>=this.limit){const loop=this.loop?.();this.stop();if(loop){this.pos=loop[0];this.start();}return;}
        while(this.nextNote<this.notes.length&&this.notes[this.nextNote].start<=h){const n=this.notes[this.nextNote++];
          if(n.end>now&&n.start<this.limit)this.voice.scheduleNote(n,this.pos+c.currentTime-this.zero,Math.max(.001,lead));}
        while(this.nextClick<this.clicks.length&&this.clicks[this.nextClick].time<=h){const ev=this.clicks[this.nextClick++];
          if(ev.time<now-.012||ev.time<this.pos-.001)continue;
          const at=Math.max(c.currentTime+.001,this.zero+ev.time-this.pos),o=c.createOscillator(),g=c.createGain();
          o.frequency.value=ev.accent?1280:830;g.gain.setValueAtTime(.004,at);g.gain.linearRampToValueAtTime(1,at+.002);g.gain.exponentialRampToValueAtTime(.001,at+.027);
          o.connect(g).connect(this.met);this.nodes.add(o);o.onended=()=>{o.disconnect();g.disconnect();this.nodes.delete(o);};o.start(at);o.stop(at+.029);}
      };
      schedule();this.timer=setInterval(schedule,25);
    }
    stopGuide(){
      for(const voice of this.voice?.scheduled||[]){voice.envelope.disconnect();try{voice.oscillator.stop();voice.vibrato.stop();}catch{}}
      this.voice?.scheduled.clear();
      for(const n of this.nodes){try{n.stop();}catch{}}this.nodes.clear();
    }
    stop(){
      if(this.playing)this.pos=this.now();this.playing=false;clearInterval(this.timer);
      if(this.source){try{this.source.stop();}catch{}this.source.disconnect();this.source=null;}
      this.stopGuide();
    }
  }
  root.AlignmentTransport=Transport;
})(globalThis);
