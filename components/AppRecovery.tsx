import React from 'react';
import {useUpdateProtection} from '../hooks/useUpdateProtection';

// No automatic reload: a failed screen may still have an unfinished basket or
// another form in the workspace. Never clear local storage during recovery.
export function ScreenRecovery({onOverview}: {onOverview?: () => void}) {
  useUpdateProtection(true);
  return <section role="alert" aria-labelledby="htos-recovery-title" style={{fontFamily:'inherit',maxWidth:640,margin:'8vh auto',padding:28,color:'#263e25',background:'#fff',border:'1px solid #dce2d3',borderRadius:16}}>
    <p style={{fontWeight:700}}>HTOS</p>
    <h1 id="htos-recovery-title">This screen could not open</h1>
    <p>A required app file could not load, or this screen encountered a problem.</p>
    <p>{onOverview?'Check your connection. You can return to Overview and check for updates. You do not need to send an order.':'Check your connection, then refresh HTOS when you are ready.'}</p>
    <p>Refreshing will close open forms. Save any work you can first. Saved drafts are kept, but unsaved fields may need to be entered again.</p>
    <div style={{display:'flex',flexWrap:'wrap',gap:12}}>
      {onOverview&&<button type="button" style={recoveryButton} onClick={onOverview}>Return to Overview</button>}
      <button type="button" style={{...recoveryButton,background:'#fff',color:'#263e25'}} onClick={()=>{
        if(window.confirm('Refresh HTOS now? Open forms will close and unsaved fields may be lost. Saved drafts will not be deleted. Cancel to keep this tab open.')) window.location.reload();
      }}>Refresh HTOS</button>
    </div>
  </section>;
}
const recoveryButton: React.CSSProperties = {padding:'12px 20px',background:'#3d5d32',color:'white',border:'1px solid #3d5d32',borderRadius:8,cursor:'pointer',font:'inherit'};

export class AppRecovery extends React.Component<{children:React.ReactNode; onOverview?: () => void; resetKey?: string},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidUpdate(previous: Readonly<{resetKey?: string}>) {
    // Reset failures on navigation without remounting healthy forms on tab/filter changes.
    if(this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({failed:false});
  }
  render(){
    if(!this.state.failed)return this.props.children;
    return <ScreenRecovery onOverview={this.props.onOverview}/>;
  }
}
