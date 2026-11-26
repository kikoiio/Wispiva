shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, world_vertex_coords;

varying vec3 wpos;

void vertex() {
	wpos = VERTEX;
}

void fragment() {
	float wave = sin(wpos.x * 0.31 + TIME * 0.7) * sin(wpos.z * 0.23 - TIME * 0.55);
	vec3 deep = vec3(0.07, 0.22, 0.34);
	vec3 glaze = vec3(0.16, 0.38, 0.48);
	ALBEDO = mix(deep, glaze, 0.5 + 0.5 * wave);
	ROUGHNESS = 0.16;
	METALLIC = 0.04;
	ALPHA = 0.86;
}
