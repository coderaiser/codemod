import { Component, PureComponent } from "react";

class C extends Component {
  render() {
    return (
      <div
        ref={(ref) => {
          this.refs.refName = ref;
        }}
      />
    );
  }
}

class C1 extends PureComponent {
  render() {
    return (
      <div
        ref={(ref) => {
          this.refs.refName = ref;
        }}
      />
    );
  }
}
