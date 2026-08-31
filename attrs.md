========================================================================================================
                    Three.js 场景可调属性总览
========================================================================================================


一、相机（Camera）
----------------------------------------
相机类型         属性名              说明
----------------------------------------
PerspectiveCamera
  fov              视野角度（度）
  aspect           宽高比
  near             近裁剪面
  far              远裁剪面
  position         位置（x, y, z）
  rotation         旋转（x, y, z, order）
  quaternion       四元数旋转
  scale            缩放（x, y, z）

OrthographicCamera
  left             左裁剪面
  right            右裁剪面
  top              上裁剪面
  bottom           下裁剪面
  near             近裁剪面
  far              远裁剪面
  position         位置（x, y, z）
  rotation         旋转（x, y, z, order）
  quaternion       四元数旋转
  scale            缩放（x, y, z）


二、灯光（Light）
----------------------------------------
灯光类型         属性名              说明
----------------------------------------
AmbientLight
  color            颜色
  intensity        强度

DirectionalLight
  color            颜色
  intensity        强度
  position         位置（x, y, z）
  target           目标点
  castShadow       是否投射阴影
  shadow           阴影参数（mapSize, camera 等）

PointLight
  color            颜色
  intensity        强度
  distance         衰减距离（0 = 无限）
  decay            衰减系数
  position         位置（x, y, z）
  castShadow       是否投射阴影

SpotLight
  color            颜色
  intensity        强度
  distance         衰减距离（0 = 无限）
  angle            锥角（弧度）
  penumbra         边缘柔和度（0~1）
  decay            衰减系数
  position         位置（x, y, z）
  target           目标点
  castShadow       是否投射阴影

HemisphereLight
  skyColor         天空颜色
  groundColor      地面颜色
  intensity        强度
  position         位置（x, y, z）

RectAreaLight
  color            颜色
  intensity        强度
  width            宽度
  height           高度
  position         位置（x, y, z）
  rotation         旋转（x, y, z）


三、材质（Material）
----------------------------------------
材质类型         属性名              说明
----------------------------------------
（公共属性）
  color            固有色
  emissive         自发光颜色
  emissiveIntensity 自发光强度
  wireframe        线框模式
  transparent      透明开关
  opacity          透明度
  side             渲染面
  depthTest        深度测试
  depthWrite       深度写入
  blending         混合模式
  fog              雾效
  toneMapped       色调映射

MeshLambertMaterial
  flatShading      平面着色

MeshPhongMaterial
  specular         高光颜色
  shininess        高光锐度
  flatShading      平面着色

MeshStandardMaterial
  roughness        粗糙度
  metalness        金属度
  flatShading      平面着色

MeshPhysicalMaterial
  roughness        粗糙度
  metalness        金属度
  flatShading      平面着色
  clearcoat        清漆强度
  clearcoatRoughness 清漆粗糙度
  transmission     透射率
  thickness        厚度
  ior              折射率
  sheen            绒毛光泽
  sheenRoughness   绒毛粗糙度
  iridescence      虹彩强度
  iridescenceIOR   虹彩折射率
  anisotropy       各向异性
  anisotropyRotation 各向异性旋转

PointsMaterial
  size             粒子大小
  sizeAttenuation  大小衰减

ShaderMaterial
  vertexShader     顶点着色器代码
  fragmentShader   片元着色器代码
  uniforms         自定义变量


四、物体变换（Transform）
----------------------------------------
所有 Object3D 子类（Mesh, Group, Light, Camera 等）共有：

属性名              说明
----------------------------------------
position.x          X 轴位置
position.y          Y 轴位置
position.z          Z 轴位置
rotation.x          X 轴旋转（弧度）
rotation.y          Y 轴旋转（弧度）
rotation.z          Z 轴旋转（弧度）
rotation.order      旋转顺序（XYZ, YXZ 等）
quaternion         四元数（替代 rotation）
scale.x             X 轴缩放
scale.y             Y 轴缩放
scale.z             Z 轴缩放
up                  上方向量
visible             可见性
castShadow          是否投射阴影
receiveShadow       是否接收阴影
layers              图层掩码