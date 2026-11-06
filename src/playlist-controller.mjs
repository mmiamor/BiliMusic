import {entryKey} from './library.mjs';
import {renderPlaylists,renderPlaylistPicker} from './playlist-view.mjs';

export class PlaylistController {
  constructor({repository,helpers,onChange,onNavigate,onPlay,onAdded,queue}) {
    Object.assign(this,{repository,helpers,onChange,onNavigate,onPlay,onAdded,queue});
    this.state={items:[],current:null,loading:false,busy:false,error:'',creating:false,editing:false,confirmDelete:false};
    this.token=0;this.pickTrack=null;
  }
  view(){return renderPlaylists(this.state,this.helpers);}
  pickerView(){return renderPlaylistPicker({...this.state,track:this.pickTrack,busy:this.state.busy||this.state.loading},this.helpers);}
  async load(id=null) {
    const token=++this.token;
    Object.assign(this.state,{loading:true,error:'',current:null,creating:false,editing:false,confirmDelete:false});this.onChange();
    try{const result=await this.repository.call(id?'get':'list',id?{id}:{});if(token!==this.token)return;
      if(id)this.state.current=result.playlist;else this.state.items=result.playlists;
    }catch(error){if(token===this.token)this.state.error=error.message;}
    finally{if(token===this.token){this.state.loading=false;this.onChange();}}
  }
  async picker(track) {this.pickTrack=track;await this.load();}
  update(result) {
    const p=result?.playlist;if(!p)return;
    if(this.state.current?.id===p.id)this.state.current=p;
    const meta={...p,tracks:undefined,trackCount:p.trackCount??p.tracks?.length??0};
    const index=this.state.items.findIndex(x=>x.id===p.id);
    if(index<0)this.state.items.unshift(meta);else this.state.items[index]=meta;
  }
  async mutate(fn) {
    if(this.state.busy)return;
    this.state.busy=true;this.state.error='';this.onChange();
    try{await fn();}catch(error){this.state.error=error.message||'歌单操作失败，请重试。';}
    finally{this.state.busy=false;this.onChange();}
  }
  async submit(form) {
    const kind=form.dataset.playlistForm,name=form.elements.name.value,description=form.elements.description?.value||'';
    const current=this.state.current;
    this.state.draft={name,description};
    await this.mutate(async()=>{
      if(kind==='edit') {
        const result=await this.repository.call('update',{id:current.id,name,description});this.update(result);this.state.editing=false;
      }else{
        const result=await this.repository.call('create',{name,description});this.update(result);
        if(kind==='create-add') {
          const added=await this.repository.call('add',{id:result.playlist.id,tracks:[this.pickTrack]});this.update(added);this.onAdded();
        }else{this.state.current=result.playlist;this.state.creating=false;this.onNavigate();}
      }
      this.state.draft=null;
    });
  }
  async command(action,value) {
    const current=this.state.current;
    if(action==='playlist-open'){this.onNavigate();await this.load(value);return;}
    if(action==='playlist-create'){this.state.creating=true;this.state.draft=null;this.onChange();return;}
    if(action==='playlist-form-close'){Object.assign(this.state,{creating:false,editing:false,confirmDelete:false,draft:null,error:''});this.onChange();return;}
    if(action==='playlist-edit'){this.state.editing=true;this.state.draft=null;this.onChange();return;}
    if(action==='playlist-delete'){this.state.confirmDelete=true;this.onChange();return;}
    if(action==='playlist-play'){if(current?.tracks.length)this.onPlay([...current.tracks]);return;}
    await this.mutate(async()=>{
      switch(action){
        case 'playlist-delete-confirm':
          if(!current)return;await this.repository.call('delete',{id:current.id});this.state.items=this.state.items.filter(p=>p.id!==current.id);this.state.current=null;this.state.confirmDelete=false;break;
        case 'playlist-pick':
          if(!this.pickTrack)return;this.update(await this.repository.call('add',{id:value,tracks:[this.pickTrack]}));this.onAdded();break;
        case 'playlist-add-queue':
          this.update(await this.repository.call('add',{id:value,tracks:[...this.queue()]}));break;
        case 'playlist-remove': {
          const track=current?.tracks[Number(value)];if(!track)return;
          this.update(await this.repository.call('remove',{id:current.id,trackKey:entryKey(track)}));break;
        }
        case 'playlist-move': {
          const [index,delta]=value.split(':').map(Number),tracks=[...current.tracks],next=index+delta;
          if(!Number.isInteger(index)||![1,-1].includes(delta)||next<0||next>=tracks.length)return;
          [tracks[index],tracks[next]]=[tracks[next],tracks[index]];
          this.update(await this.repository.call('reorder',{id:current.id,keys:tracks.map(entryKey)}));break;
        }
      }
    });
  }
}
