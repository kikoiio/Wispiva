shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, shadows_disabled;

instance uniform float opacity = 0.0;

void vertex() {
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
}

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	p.x += sin(p.y * 4.2 + TIME * 0.72) * 0.19;
	float soft_edge = pow(max(1.0 - dot(p, p), 0.0), 2.25);
	float curls = 0.74 + 0.26 * sin(p.x * 5.2 + p.y * 4.3 - TIME * 1.26);
	ALBEDO = vec3(0.94, 0.80, 0.71);
	ALPHA = soft_edge * curls * opacity;
}
