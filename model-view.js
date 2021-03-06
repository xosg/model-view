2021 / 11 / 20;

const vs = `
  attribute vec4 position;
  uniform mat4 perspect;
  uniform mat4 orbit;
  varying vec3 location;
  void main() {
    gl_Position = perspect * orbit * position;
    location = gl_Position.xyz;
  }
`;

// flat shading: 平行光来自视点
// 不支持透明色
const fs = `
  #extension GL_OES_standard_derivatives : enable
  precision mediump float;
  varying vec3 location;
  uniform vec3 color;
  void main () {
    vec3 normal = cross(dFdx(location), dFdy(location));
    float light = normal.z / length(normal);
    gl_FragColor = vec4(color * light, 1);
  }
`;

class ModelView extends HTMLCanvasElement {
  zoom = 1;
  angleX = 0;
  angleY = 0;
  constructor() {
    super();
    window.mv = this;

    this.addEventListener(
      "wheel",
      (e) => {
        // e.preventDefault();
        this.zoom += e.deltaY / 100;
        this.zoom = Math.min(Math.max(this.zoom, 0.5), 2);
        this.render();
      },
      { passive: true }
    );

    this.addEventListener("mousemove", (e) => {
      this.angleX += e.movementX / 300;
      this.angleY += e.movementY / 300;
      this.angleY = Math.min(Math.max(this.angleY, -Math.PI / 2), Math.PI / 2);
      this.render();
    });
  }

  async connectedCallback() {
    if (!this.isConnected) return;

    // 加载动画: 30°时，斜边是短边的2倍
    const w = 3;
    const background =
      `center / ${w * 4}mm 1cm repeat no-repeat ` +
      `repeating-linear-gradient(-30deg, white 0, white ${w}mm, black ${w}mm, black ${w * 2}mm)`;
    const animation = this.animate(
      [
        { backgroundPositionX: "0", background },
        { backgroundPositionX: w * 4 + "mm", background },
      ],
      {
        duration: 500,
        iterations: Infinity,
      }
    );

    const ctx = this.getContext("webgl");
    this.ctx = ctx;
    const { width, height } = this;
    const src = this.getAttribute("src");
    let buffer = await fetch(src).then((x) => x.arrayBuffer());

    const json_length = new Uint32Array(buffer.slice(0, 4))[0];
    const { position_length, extensions, groups, length } = JSON.parse(
      new TextDecoder().decode(buffer.slice(4, 4 + json_length))
    );
    buffer = buffer.slice(4 + json_length);
    const POSITION = buffer.slice(0, position_length);
    const TRIANGLE = buffer.slice(position_length);

    console.log("✅", src);
    ctx.enable(ctx.DEPTH_TEST);
    ctx.enable(ctx.CULL_FACE);
    // flat shading
    ctx.getExtension("OES_standard_derivatives");
    extensions.forEach((e) => ctx.getExtension(e));

    const pgm = ctx.createProgram();
    this.pgm = pgm;
    const VS = ctx.createShader(ctx.VERTEX_SHADER);
    ctx.shaderSource(VS, vs);
    ctx.compileShader(VS);
    ctx.attachShader(pgm, VS);

    const FS = ctx.createShader(ctx.FRAGMENT_SHADER);
    ctx.shaderSource(FS, fs);
    ctx.compileShader(FS);
    ctx.attachShader(pgm, FS);

    ctx.linkProgram(pgm);
    ctx.useProgram(pgm);

    // 包围球直径
    this.length = length;
    this.groups = groups;

    const near = length / 100;
    const far = length * 3;

    ctx.viewport(0, 0, width, height);

    const aspect = width / height;
    // 视点到物体距离 = 物体长度，所以FoV约等于1
    const yFoV = Math.PI / 3;
    const tangent = Math.tan(Math.PI / 2 - yFoV / 2);

    const perspect = [
      [tangent / aspect, 0, 0, 0],
      [0, tangent, 0, 0],
      [0, 0, (near + far) / (near - far), -1],
      [0, 0, (near * far * 2) / (near - far), 0],
    ].flat();

    ctx.uniformMatrix4fv(ctx.getUniformLocation(pgm, "perspect"), false, perspect);

    ctx.bindBuffer(ctx.ARRAY_BUFFER, ctx.createBuffer());
    const position = ctx.getAttribLocation(pgm, "position");
    ctx.enableVertexAttribArray(position);

    ctx.vertexAttribPointer(position, 3, ctx.FLOAT, false, 0, 0);
    ctx.bufferData(ctx.ARRAY_BUFFER, POSITION, ctx.STATIC_DRAW);

    ctx.bindBuffer(ctx.ELEMENT_ARRAY_BUFFER, ctx.createBuffer());
    ctx.bufferData(ctx.ELEMENT_ARRAY_BUFFER, TRIANGLE, ctx.STATIC_DRAW);

    this.render();
    animation.cancel();
  }

  disconnectedCallback() {
    // cancelAnimationFrame(this.frame);
  }

  static observedAttributes = ["src"];
  attributeChangedCallback(name, oldValue, newValue) {
    this.connectedCallback();
  }

  render = () => {
    const { ctx, pgm, angleX, angleY, length, zoom, groups } = this;
    const CosX = Math.cos(angleX);
    const SinX = Math.sin(angleX);
    const CosY = Math.cos(angleY);
    const SinY = Math.sin(angleY);

    // 物距
    const distance = -length * zoom;
    // 列主序：先绕X，再绕Y
    const orbit = [
      [CosX, SinY * SinX, -SinX * CosY, 0],
      [0, CosY, SinY, 0],
      [SinX, -SinY * CosX, CosX * CosY, 0],
      [0, 0, distance, 1],
    ].flat();

    ctx.uniformMatrix4fv(ctx.getUniformLocation(pgm, "orbit"), false, orbit);

    groups.forEach((group) => {
      ctx.uniform3fv(ctx.getUniformLocation(pgm, "color"), group.color);
      ctx.drawElements(ctx.TRIANGLES, group.indexCount, group.componentType, group.offset);
    });

    // this.frame = requestAnimationFrame(this.render);
  };
}

customElements.define("model-view", ModelView, { extends: "canvas" });

// uglifyjs model-view.js > model-view.min.js
